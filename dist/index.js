// src/farcaster-client.ts
import { elizaLogger as elizaLogger5 } from "@elizaos/core";

// src/client.ts
import { elizaLogger } from "@elizaos/core";
import { isApiErrorResponse } from "@neynar/nodejs-sdk";
var FarcasterClient = class {
  runtime;
  neynar;
  signerUuid;
  cache;
  lastInteractionTimestamp;
  farcasterConfig;
  constructor(opts) {
    this.cache = opts.cache;
    this.runtime = opts.runtime;
    this.neynar = opts.neynar;
    this.signerUuid = opts.signerUuid;
    this.lastInteractionTimestamp = /* @__PURE__ */ new Date();
    this.farcasterConfig = opts.farcasterConfig;
  }
  async loadCastFromNeynarResponse(neynarResponse) {
    const profile = await this.getProfile(neynarResponse.author.fid);
    return {
      hash: neynarResponse.hash,
      authorFid: neynarResponse.author.fid,
      text: neynarResponse.text,
      profile,
      ...neynarResponse.parent_hash ? {
        inReplyTo: {
          hash: neynarResponse.parent_hash,
          fid: neynarResponse.parent_author.fid
        }
      } : {},
      timestamp: new Date(neynarResponse.timestamp)
    };
  }
  async publishLike(castHash, retryTimes) {
    try {
      const result = await this.neynar.publishReaction({
        signerUuid: this.signerUuid,
        reactionType: "like",
        target: castHash
      });
      if (result.success) {
        return true;
      }
      return false;
    } catch (err) {
      if (isApiErrorResponse(err)) {
        elizaLogger.error("Neynar error: ", err.response.data);
        throw err.response.data;
      } else {
        elizaLogger.error("Error: ", err);
        throw err;
      }
    }
  }
  async publishCast(cast, parentCastId, retryTimes) {
    try {
      const result = await this.neynar.publishCast({
        signerUuid: this.signerUuid,
        text: cast,
        parent: parentCastId == null ? void 0 : parentCastId.hash
      });
      if (result.success) {
        return {
          hash: result.cast.hash,
          authorFid: result.cast.author.fid,
          text: result.cast.text
        };
      }
    } catch (err) {
      if (isApiErrorResponse(err)) {
        elizaLogger.error("Neynar error: ", err.response.data);
        throw err.response.data;
      } else {
        elizaLogger.error("Error: ", err);
        throw err;
      }
    }
  }
  async getCast(castHash) {
    const response = await this.neynar.lookupCastByHashOrWarpcastUrl({
      identifier: castHash,
      type: "hash"
    });
    const cast = {
      hash: response.cast.hash,
      authorFid: response.cast.author.fid,
      text: response.cast.text,
      profile: {
        fid: response.cast.author.fid,
        name: response.cast.author.display_name || "anon",
        username: response.cast.author.username
      },
      ...response.cast.parent_hash ? {
        inReplyTo: {
          hash: response.cast.parent_hash,
          fid: response.cast.parent_author.fid
        }
      } : {},
      timestamp: new Date(response.cast.timestamp)
    };
    return cast;
  }
  async getCastsByFid(request) {
    const timeline = [];
    const response = await this.neynar.fetchCastsForUser({
      fid: request.fid,
      limit: request.pageSize
    });
    response.casts.map((cast) => {
      this.cache.set(`farcaster/cast/${cast.hash}`, cast);
      timeline.push({
        hash: cast.hash,
        authorFid: cast.author.fid,
        text: cast.text,
        profile: {
          fid: cast.author.fid,
          name: cast.author.display_name || "anon",
          username: cast.author.username
        },
        timestamp: new Date(cast.timestamp)
      });
    });
    return timeline;
  }
  async getMentions(request) {
    const neynarMentionsResponse = await this.neynar.fetchAllNotifications({
      fid: request.fid,
      type: ["mentions", "replies"]
    });
    const mentions = [];
    neynarMentionsResponse.notifications.filter((notification) => notification.cast).map((notification) => {
      const cast = {
        hash: notification.cast.hash,
        authorFid: notification.cast.author.fid,
        text: notification.cast.text,
        profile: {
          fid: notification.cast.author.fid,
          name: notification.cast.author.display_name || "anon",
          username: notification.cast.author.username
        },
        ...notification.cast.parent_hash ? {
          inReplyTo: {
            hash: notification.cast.parent_hash,
            fid: notification.cast.parent_author.fid
          }
        } : {},
        timestamp: new Date(notification.cast.timestamp)
      };
      mentions.push(cast);
      this.cache.set(`farcaster/cast/${cast.hash}`, cast);
    });
    return mentions;
  }
  async getProfile(fid) {
    if (this.cache.has(`farcaster/profile/${fid}`)) {
      return this.cache.get(`farcaster/profile/${fid}`);
    }
    const result = await this.neynar.fetchBulkUsers({ fids: [fid] });
    if (!result.users || result.users.length < 1) {
      elizaLogger.error("Error fetching user by fid");
      throw "getProfile ERROR";
    }
    const neynarUserProfile = result.users[0];
    const profile = {
      fid,
      name: "",
      username: ""
    };
    profile.name = neynarUserProfile.display_name;
    profile.username = neynarUserProfile.username;
    profile.bio = neynarUserProfile.profile.bio.text;
    profile.pfp = neynarUserProfile.pfp_url;
    this.cache.set(`farcaster/profile/${fid}`, profile);
    return profile;
  }
  async getTimeline(request) {
    const timeline = [];
    const results = await this.getCastsByFid(request);
    for (const cast of results) {
      this.cache.set(`farcaster/cast/${cast.hash}`, cast);
      timeline.push(cast);
    }
    return {
      timeline
      //TODO implement paging
      //nextPageToken: results.nextPageToken,
    };
  }
};

// src/post.ts
import {
  composeContext,
  generateText,
  ModelClass,
  elizaLogger as elizaLogger3,
  getEmbeddingZeroVector as getEmbeddingZeroVector2
} from "@elizaos/core";

// src/prompts.ts
import {
  shouldRespondFooter
} from "@elizaos/core";
var formatCast = (cast) => {
  return `ID: ${cast.hash}
    From: ${cast.profile.name} (@${cast.profile.username})${cast.profile.username})${cast.inReplyTo ? `
In reply to: ${cast.inReplyTo.fid}` : ""}
Text: ${cast.text}`;
};
var formatTimeline = (character, timeline) => `# ${character.name}'s Home Timeline
${timeline.map(formatCast).join("\n")}
`;
var headerTemplate = `
{{timeline}}

# Knowledge
{{knowledge}}

About {{agentName}} (@{{farcasterUsername}}):
{{bio}}
{{lore}}
{{postDirections}}

{{providers}}

{{recentPosts}}

{{characterPostExamples}}`;
var postTemplate = headerTemplate + `
# Task: Generate a post in the voice and style of {{agentName}}, aka @{{farcasterUsername}}
Write a single sentence post that is {{adjective}} about {{topic}} (without mentioning {{topic}} directly), from the perspective of {{agentName}}.
Try to write something totally different than previous posts. Do not add commentary or ackwowledge this request, just write the post.

Your response should not contain any questions. Brief, concise statements only. No emojis. Use \\n\\n (double spaces) between statements.`;
var customMessageCompletionFooter = `
Response format should be formatted in a valid JSON block like this:
  \`\`\`json
  { "user": "{{agentName}}", "text": "<string>" }
  \`\`\`
  OR
  \`\`\`json
  { "user": "{{agentName}}", "action": "<string>" }
  \`\`\`
  
  The \u201Caction\u201D field should be one of the options in [Available Actions], and the "text" field should be the response you want to send. Only one of these fields should be present in the response.
  `;
var messageHandlerTemplate = headerTemplate + `
Recent interactions between {{agentName}} and other users:
{{recentPostInteractions}}

Thread of casts You Are Replying To:
{{formattedConversation}}

# Task: Generate a post in the voice, style and perspective of {{agentName}} (@{{farcasterUsername}}):
{{currentPost}}` + customMessageCompletionFooter;
var shouldRespondTemplate = (
  //
  `# Task: Decide if {{agentName}} should respond.
    About {{agentName}}:
    {{bio}}

    # INSTRUCTIONS: Determine if {{agentName}} (@{{farcasterUsername}}) should respond to the message and participate in the conversation. Do not comment. Just respond with "RESPOND" or "IGNORE" or "STOP".

Response options are RESPOND, IGNORE and STOP.

{{agentName}} should respond to messages that are directed at them, or participate in conversations that are interesting or relevant to their background, IGNORE messages that are irrelevant to them, and should STOP if the conversation is concluded.

{{agentName}} is in a room with other users and wants to be conversational, but not annoying.
{{agentName}} should RESPOND to messages that are directed at them, or participate in conversations that are interesting or relevant to their background.
If a message is not interesting or relevant, {{agentName}} should IGNORE.
If a message thread has become repetitive, {{agentName}} should IGNORE.
Unless directly RESPONDing to a user, {{agentName}} should IGNORE messages that are very short or do not contain much information.
If a user asks {{agentName}} to stop talking, {{agentName}} should STOP.
If {{agentName}} concludes a conversation and isn't part of the conversation anymore, {{agentName}} should STOP.

IMPORTANT: {{agentName}} (aka @{{farcasterUsername}}) is particularly sensitive about being annoying, so if there is any doubt, it is better to IGNORE than to RESPOND.

Thread of messages You Are Replying To:
{{formattedConversation}}

Current message:
{{currentPost}}

` + shouldRespondFooter
);

// src/utils.ts
import { stringToUuid } from "@elizaos/core";
var MAX_CAST_LENGTH = 1024;
function castId({ hash, agentId }) {
  return `${hash}-${agentId}`;
}
function castUuid(props) {
  return stringToUuid(castId(props));
}
function splitPostContent(content, maxLength = MAX_CAST_LENGTH) {
  const paragraphs = content.split("\n\n").map((p) => p.trim());
  const posts = [];
  let currentTweet = "";
  for (const paragraph of paragraphs) {
    if (!paragraph) continue;
    if ((currentTweet + "\n\n" + paragraph).trim().length <= maxLength) {
      if (currentTweet) {
        currentTweet += "\n\n" + paragraph;
      } else {
        currentTweet = paragraph;
      }
    } else {
      if (currentTweet) {
        posts.push(currentTweet.trim());
      }
      if (paragraph.length <= maxLength) {
        currentTweet = paragraph;
      } else {
        const chunks = splitParagraph(paragraph, maxLength);
        posts.push(...chunks.slice(0, -1));
        currentTweet = chunks[chunks.length - 1];
      }
    }
  }
  if (currentTweet) {
    posts.push(currentTweet.trim());
  }
  return posts;
}
function splitParagraph(paragraph, maxLength) {
  const sentences = paragraph.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [
    paragraph
  ];
  const chunks = [];
  let currentChunk = "";
  for (const sentence of sentences) {
    if ((currentChunk + " " + sentence).trim().length <= maxLength) {
      if (currentChunk) {
        currentChunk += " " + sentence;
      } else {
        currentChunk = sentence;
      }
    } else {
      if (currentChunk) {
        chunks.push(currentChunk.trim());
      }
      if (sentence.length <= maxLength) {
        currentChunk = sentence;
      } else {
        const words = sentence.split(" ");
        currentChunk = "";
        for (const word of words) {
          if ((currentChunk + " " + word).trim().length <= maxLength) {
            if (currentChunk) {
              currentChunk += " " + word;
            } else {
              currentChunk = word;
            }
          } else {
            if (currentChunk) {
              chunks.push(currentChunk.trim());
            }
            currentChunk = word;
          }
        }
      }
    }
  }
  if (currentChunk) {
    chunks.push(currentChunk.trim());
  }
  return chunks;
}

// src/memory.ts
import {
  elizaLogger as elizaLogger2,
  getEmbeddingZeroVector,
  stringToUuid as stringToUuid2
} from "@elizaos/core";
import { toHex } from "viem";
function createCastMemory({
  roomId,
  senderId,
  runtime,
  cast
}) {
  const inReplyTo = cast.inReplyTo ? castUuid({
    hash: toHex(cast.inReplyTo.hash),
    agentId: runtime.agentId
  }) : void 0;
  return {
    id: castUuid({
      hash: cast.hash,
      agentId: runtime.agentId
    }),
    agentId: runtime.agentId,
    userId: senderId,
    content: {
      text: cast.text,
      source: "farcaster",
      url: "",
      inReplyTo,
      hash: cast.hash
    },
    roomId,
    embedding: getEmbeddingZeroVector()
  };
}
async function buildConversationThread({
  cast,
  runtime,
  client
}) {
  const thread = [];
  const visited = /* @__PURE__ */ new Set();
  async function processThread(currentCast) {
    if (visited.has(currentCast.hash)) {
      return;
    }
    visited.add(currentCast.hash);
    const roomId = castUuid({
      hash: currentCast.hash,
      agentId: runtime.agentId
    });
    const memory = await runtime.messageManager.getMemoryById(roomId);
    if (!memory) {
      elizaLogger2.log("Creating memory for cast", currentCast.hash);
      const userId = stringToUuid2(currentCast.authorFid.toString());
      await runtime.ensureConnection(
        userId,
        roomId,
        currentCast.profile.username,
        currentCast.profile.name,
        "farcaster"
      );
      await runtime.messageManager.createMemory(
        createCastMemory({
          roomId,
          senderId: userId,
          runtime,
          cast: currentCast
        })
      );
    }
    thread.unshift(currentCast);
    if (currentCast.inReplyTo) {
      const parentCast = await client.getCast(currentCast.inReplyTo.hash);
      await processThread(parentCast);
    }
  }
  await processThread(cast);
  return thread;
}

// src/actions.ts
async function sendCast({
  client,
  runtime,
  content,
  roomId,
  inReplyTo,
  profile
}) {
  const chunks = splitPostContent(content.text);
  const sent = [];
  let parentCastId = inReplyTo;
  for (const chunk of chunks) {
    const neynarCast = await client.publishCast(chunk, parentCastId);
    if (neynarCast) {
      const cast = {
        hash: neynarCast.hash,
        authorFid: neynarCast.authorFid,
        text: neynarCast.text,
        profile,
        inReplyTo: parentCastId,
        timestamp: /* @__PURE__ */ new Date()
      };
      sent.push(cast);
      parentCastId = {
        fid: neynarCast.authorFid,
        hash: neynarCast.hash
      };
    }
  }
  return sent.map((cast) => ({
    cast,
    memory: createCastMemory({
      roomId,
      senderId: runtime.agentId,
      runtime,
      cast
    })
  }));
}

// src/post.ts
var FarcasterPostManager = class {
  constructor(client, runtime, signerUuid, cache) {
    this.signerUuid = signerUuid;
    this.cache = cache;
    var _a, _b;
    this.client = client;
    this.runtime = runtime;
    this.fid = ((_a = this.client.farcasterConfig) == null ? void 0 : _a.FARCASTER_FID) ?? 0;
    this.isDryRun = ((_b = this.client.farcasterConfig) == null ? void 0 : _b.FARCASTER_DRY_RUN) ?? false;
    elizaLogger3.log("Farcaster Client Configuration:");
    elizaLogger3.log(`- FID: ${this.fid}`);
    elizaLogger3.log(
      `- Dry Run Mode: ${this.isDryRun ? "enabled" : "disabled"}`
    );
    elizaLogger3.log(
      `- Enable Post: ${this.client.farcasterConfig.ENABLE_POST ? "enabled" : "disabled"}`
    );
    if (this.client.farcasterConfig.ENABLE_POST) {
      elizaLogger3.log(
        `- Post Interval: ${this.client.farcasterConfig.POST_INTERVAL_MIN}-${this.client.farcasterConfig.POST_INTERVAL_MAX} minutes`
      );
      elizaLogger3.log(
        `- Post Immediately: ${this.client.farcasterConfig.POST_IMMEDIATELY ? "enabled" : "disabled"}`
      );
    }
    elizaLogger3.log(
      `- Action Processing: ${this.client.farcasterConfig.ENABLE_ACTION_PROCESSING ? "enabled" : "disabled"}`
    );
    elizaLogger3.log(
      `- Action Interval: ${this.client.farcasterConfig.ACTION_INTERVAL} minutes`
    );
    if (this.isDryRun) {
      elizaLogger3.log(
        "Farcaster client initialized in dry run mode - no actual casts should be posted"
      );
    }
  }
  client;
  runtime;
  fid;
  isDryRun;
  timeout;
  async start() {
    const generateNewCastLoop = async () => {
      const lastPost = await this.runtime.cacheManager.get("farcaster/" + this.fid + "/lastPost");
      const lastPostTimestamp = (lastPost == null ? void 0 : lastPost.timestamp) ?? 0;
      const minMinutes = this.client.farcasterConfig.POST_INTERVAL_MIN;
      const maxMinutes = this.client.farcasterConfig.POST_INTERVAL_MAX;
      const randomMinutes = Math.floor(Math.random() * (maxMinutes - minMinutes + 1)) + minMinutes;
      const delay = randomMinutes * 60 * 1e3;
      if (Date.now() > lastPostTimestamp + delay) {
        try {
          await this.generateNewCast();
        } catch (error) {
          elizaLogger3.error(error);
          return;
        }
      }
      this.timeout = setTimeout(() => {
        generateNewCastLoop();
      }, delay);
      elizaLogger3.log(`Next cast scheduled in ${randomMinutes} minutes`);
    };
    if (this.client.farcasterConfig.ENABLE_POST) {
      if (this.client.farcasterConfig.POST_IMMEDIATELY) {
        await this.generateNewCast();
      }
      generateNewCastLoop();
    }
  }
  async stop() {
    if (this.timeout) clearTimeout(this.timeout);
  }
  async generateNewCast() {
    var _a;
    elizaLogger3.info("Generating new cast");
    try {
      const profile = await this.client.getProfile(this.fid);
      await this.runtime.ensureUserExists(
        this.runtime.agentId,
        profile.username,
        this.runtime.character.name,
        "farcaster"
      );
      const { timeline } = await this.client.getTimeline({
        fid: this.fid,
        pageSize: 10
      });
      this.cache.set("farcaster/timeline", timeline);
      const formattedHomeTimeline = formatTimeline(
        this.runtime.character,
        timeline
      );
      const generateRoomId = this.runtime.agentId;
      await this.runtime.ensureRoomExists(generateRoomId);
      await this.runtime.ensureParticipantInRoom(
        this.runtime.agentId,
        generateRoomId
      );
      const existingMemories = await this.runtime.messageManager.getMemories({ roomId: generateRoomId, count: 1, start: 0 });
      let memoryToUse = existingMemories.length ? existingMemories[0] : {
        agentId: this.runtime.agentId,
        roomId: generateRoomId,
        userId: this.runtime.agentId,
        embedding: getEmbeddingZeroVector2(),
        content: {
          text: "ahhhh what a great day to be alive"
        }
      };
      if (!existingMemories.length) {
        await this.runtime.messageManager.createMemory(memoryToUse);
      }
      const state = await this.runtime.composeState(
        {
          roomId: generateRoomId,
          userId: this.runtime.agentId,
          agentId: this.runtime.agentId,
          content: memoryToUse.content
        },
        {
          farcasterUserName: profile.username,
          timeline: formattedHomeTimeline
        }
      );
      const context = composeContext({
        state,
        template: ((_a = this.runtime.character.templates) == null ? void 0 : _a.farcasterPostTemplate) || postTemplate
      });
      const newContent = await generateText({
        runtime: this.runtime,
        context,
        modelClass: ModelClass.SMALL
      });
      const slice = newContent.replaceAll(/\\n/g, "\n").trim();
      let content = slice.slice(0, MAX_CAST_LENGTH);
      if (content.length > MAX_CAST_LENGTH) {
        content = content.slice(0, content.lastIndexOf("\n"));
      }
      if (content.length > MAX_CAST_LENGTH) {
        content = content.slice(0, content.lastIndexOf("."));
      }
      if (content.length > MAX_CAST_LENGTH) {
        content = content.slice(0, content.lastIndexOf("."));
      }
      if (this.runtime.getSetting("FARCASTER_DRY_RUN") === "true") {
        elizaLogger3.info(`Dry run: would have cast: ${content}`);
        return;
      }
      try {
        const [{ cast }] = await sendCast({
          client: this.client,
          runtime: this.runtime,
          signerUuid: this.signerUuid,
          roomId: generateRoomId,
          content: { text: content },
          profile
        });
        await this.runtime.cacheManager.set(
          `farcaster/${this.fid}/lastPost`,
          {
            hash: cast.hash,
            timestamp: Date.now()
          }
        );
        const roomId = castUuid({
          agentId: this.runtime.agentId,
          hash: cast.hash
        });
        await this.runtime.ensureRoomExists(roomId);
        await this.runtime.ensureParticipantInRoom(
          this.runtime.agentId,
          roomId
        );
        elizaLogger3.info(
          `[Farcaster Neynar Client] Published cast ${cast.hash}`
        );
        await this.runtime.messageManager.createMemory(
          createCastMemory({
            roomId,
            senderId: this.runtime.agentId,
            runtime: this.runtime,
            cast
          })
        );
      } catch (error) {
        elizaLogger3.error("Error sending cast:", error);
      }
    } catch (error) {
      elizaLogger3.error("Error generating new cast:", error);
    }
  }
};

// src/interactions.ts
import {
  composeContext as composeContext2,
  generateMessageResponse,
  generateShouldRespond,
  ModelClass as ModelClass2,
  stringToUuid as stringToUuid4,
  elizaLogger as elizaLogger4,
  getEmbeddingZeroVector as getEmbeddingZeroVector3
} from "@elizaos/core";
var FarcasterInteractionManager = class {
  constructor(client, runtime, signerUuid, cache) {
    this.client = client;
    this.runtime = runtime;
    this.signerUuid = signerUuid;
    this.cache = cache;
  }
  timeout;
  async start() {
    const handleInteractionsLoop = async () => {
      var _a;
      try {
        await this.handleInteractions();
      } catch (error) {
        elizaLogger4.error(error);
      }
      this.timeout = setTimeout(
        handleInteractionsLoop,
        Number(((_a = this.client.farcasterConfig) == null ? void 0 : _a.FARCASTER_POLL_INTERVAL) ?? 120) * 1e3
        // Default to 2 minutes
      );
    };
    handleInteractionsLoop();
  }
  async stop() {
    if (this.timeout) clearTimeout(this.timeout);
  }
  async handleInteractions() {
    var _a;
    const agentFid = ((_a = this.client.farcasterConfig) == null ? void 0 : _a.FARCASTER_FID) ?? 0;
    if (!agentFid) {
      elizaLogger4.info("No FID found, skipping interactions");
      return;
    }
    const mentions = await this.client.getMentions({
      fid: agentFid,
      pageSize: 10
    });
    const agent = await this.client.getProfile(agentFid);
    for (const mention of mentions) {
      const roomId = castUuid({
        hash: mention.hash,
        agentId: this.runtime.agentId
      });
      const userId = stringToUuid4(mention.authorFid.toString());
      const pastMemoryId = castUuid({
        agentId: this.runtime.agentId,
        hash: mention.hash
      });
      const pastMemory = await this.runtime.messageManager.getMemoryById(pastMemoryId);
      if (pastMemory) {
        continue;
      }
      await this.runtime.ensureConnection(
        userId,
        roomId,
        mention.profile.username,
        mention.profile.name,
        "farcaster"
      );
      const thread = await buildConversationThread({
        client: this.client,
        runtime: this.runtime,
        cast: mention
      });
      const memory = {
        content: { text: mention.text },
        agentId: this.runtime.agentId,
        userId,
        roomId
      };
      await this.handleCast({
        agent,
        cast: mention,
        memory,
        thread
      });
    }
    this.client.lastInteractionTimestamp = /* @__PURE__ */ new Date();
  }
  async handleCast({
    agent,
    cast,
    memory,
    thread
  }) {
    var _a, _b, _c, _d, _e, _f, _g;
    if (cast.profile.fid === agent.fid) {
      elizaLogger4.info("skipping cast from bot itself", cast.hash);
      return;
    }
    if (!memory.content.text) {
      elizaLogger4.info("skipping cast with no text", cast.hash);
      return { text: "", action: "IGNORE" };
    }
    const currentPost = formatCast(cast);
    const senderId = stringToUuid4(cast.authorFid.toString());
    const { timeline } = await this.client.getTimeline({
      fid: agent.fid,
      pageSize: 10
    });
    const formattedTimeline = formatTimeline(
      this.runtime.character,
      timeline
    );
    const formattedConversation = thread.map(
      (cast2) => `@${cast2.profile.username} (${new Date(
        cast2.timestamp
      ).toLocaleString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        month: "short",
        day: "numeric"
      })}):
                ${cast2.text}`
    ).join("\n\n");
    const state = await this.runtime.composeState(memory, {
      farcasterUsername: agent.username,
      timeline: formattedTimeline,
      currentPost,
      formattedConversation
    });
    const shouldRespondContext = composeContext2({
      state,
      template: ((_a = this.runtime.character.templates) == null ? void 0 : _a.farcasterShouldRespondTemplate) || ((_c = (_b = this.runtime.character) == null ? void 0 : _b.templates) == null ? void 0 : _c.shouldRespondTemplate) || shouldRespondTemplate
    });
    const memoryId = castUuid({
      agentId: this.runtime.agentId,
      hash: cast.hash
    });
    const castMemory = await this.runtime.messageManager.getMemoryById(memoryId);
    if (!castMemory) {
      await this.runtime.messageManager.createMemory(
        createCastMemory({
          roomId: memory.roomId,
          senderId,
          runtime: this.runtime,
          cast
        })
      );
    }
    const shouldRespondResponse = await generateShouldRespond({
      runtime: this.runtime,
      context: shouldRespondContext,
      modelClass: ModelClass2.SMALL
    });
    if (shouldRespondResponse === "IGNORE" || shouldRespondResponse === "STOP") {
      elizaLogger4.info(
        `Not responding to cast because generated ShouldRespond was ${shouldRespondResponse}`
      );
      return;
    }
    const context = composeContext2({
      state,
      template: ((_d = this.runtime.character.templates) == null ? void 0 : _d.farcasterMessageHandlerTemplate) ?? ((_f = (_e = this.runtime.character) == null ? void 0 : _e.templates) == null ? void 0 : _f.messageHandlerTemplate) ?? messageHandlerTemplate
    });
    const responseContent = await generateMessageResponse({
      runtime: this.runtime,
      context,
      modelClass: ModelClass2.LARGE
    });
    responseContent.inReplyTo = memoryId;
    if (!responseContent.text && !responseContent.action) return;
    if (((_g = this.client.farcasterConfig) == null ? void 0 : _g.FARCASTER_DRY_RUN) && responseContent.text) {
      elizaLogger4.info(
        `Dry run: would have responded to cast ${cast.hash} with ${responseContent.text}`
      );
      return;
    }
    const callback = async (content, _files) => {
      try {
        if (memoryId && !content.inReplyTo) {
          content.inReplyTo = memoryId;
        }
        const results = await sendCast({
          runtime: this.runtime,
          client: this.client,
          signerUuid: this.signerUuid,
          profile: cast.profile,
          content,
          roomId: memory.roomId,
          inReplyTo: {
            fid: cast.authorFid,
            hash: cast.hash
          }
        });
        results[0].memory.content.action = content.action;
        for (const { memory: memory2 } of results) {
          await this.runtime.messageManager.createMemory(memory2);
        }
        await this.client.publishLike(cast.hash);
        return results.map((result) => result.memory);
      } catch (error) {
        elizaLogger4.error("Error sending response cast:", error);
        return [];
      }
    };
    const saveActionMemoryOnly = async () => {
      const actionOnlyMemory = {
        agentId: this.runtime.agentId,
        roomId: memory.roomId,
        userId: this.runtime.agentId,
        embedding: getEmbeddingZeroVector3(),
        content: {
          url: "",
          hash: "0x0",
          text: "(You didn't actually say anything. You just thought decided which action to execute.) ",
          action: responseContent.action,
          source: "farcaster",
          inReplyTo: responseContent.inReplyTo
        }
      };
      await this.runtime.messageManager.createMemory(actionOnlyMemory);
      return [actionOnlyMemory];
    };
    const responseMessages = responseContent.text ? await callback(responseContent) : await saveActionMemoryOnly();
    const newState = await this.runtime.updateRecentMessageState(state);
    if (responseContent.action) {
      await this.runtime.processActions(
        { ...memory, content: { ...memory.content, cast } },
        responseMessages,
        newState,
        callback
      );
    }
  }
};

// src/farcaster-client.ts
import { Configuration, NeynarAPIClient } from "@neynar/nodejs-sdk";

// src/environment.ts
import {
  parseBooleanFromText,
  ActionTimelineType
} from "@elizaos/core";
import { z, ZodError } from "zod";
var DEFAULT_MAX_CAST_LENGTH = 320;
var DEFAULT_POLL_INTERVAL = 120;
var DEFAULT_POST_INTERVAL_MIN = 90;
var DEFAULT_POST_INTERVAL_MAX = 180;
var farcasterEnvSchema = z.object({
  FARCASTER_DRY_RUN: z.boolean(),
  FARCASTER_FID: z.number().int().min(1, "Farcaster fid is required"),
  MAX_CAST_LENGTH: z.number().int().default(DEFAULT_MAX_CAST_LENGTH),
  FARCASTER_POLL_INTERVAL: z.number().int().default(DEFAULT_POLL_INTERVAL),
  ENABLE_POST: z.boolean(),
  POST_INTERVAL_MIN: z.number().int(),
  POST_INTERVAL_MAX: z.number().int(),
  ENABLE_ACTION_PROCESSING: z.boolean(),
  ACTION_INTERVAL: z.number().int(),
  POST_IMMEDIATELY: z.boolean(),
  MAX_ACTIONS_PROCESSING: z.number().int(),
  ACTION_TIMELINE_TYPE: z.nativeEnum(ActionTimelineType).default(ActionTimelineType.ForYou)
});
function safeParseInt(value, defaultValue) {
  if (!value) return defaultValue;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? defaultValue : Math.max(1, parsed);
}
async function validateFarcasterConfig(runtime) {
  try {
    const farcasterConfig = {
      FARCASTER_DRY_RUN: parseBooleanFromText(
        runtime.getSetting("FARCASTER_DRY_RUN") || process.env.FARCASTER_DRY_RUN || "false"
      ),
      FARCASTER_FID: safeParseInt(
        runtime.getSetting("FARCASTER_FID") || process.env.FARCASTER_FID,
        0
      ),
      MAX_CAST_LENGTH: safeParseInt(
        runtime.getSetting("MAX_CAST_LENGTH") || process.env.MAX_CAST_LENGTH,
        DEFAULT_MAX_CAST_LENGTH
      ),
      FARCASTER_POLL_INTERVAL: safeParseInt(
        runtime.getSetting("FARCASTER_POLL_INTERVAL") || process.env.FARCASTER_POLL_INTERVAL,
        DEFAULT_POLL_INTERVAL
      ),
      ENABLE_POST: parseBooleanFromText(
        runtime.getSetting("ENABLE_POST") || process.env.ENABLE_POST || "true"
      ),
      POST_INTERVAL_MIN: safeParseInt(
        runtime.getSetting("POST_INTERVAL_MIN") || process.env.POST_INTERVAL_MIN,
        DEFAULT_POST_INTERVAL_MIN
      ),
      POST_INTERVAL_MAX: safeParseInt(
        runtime.getSetting("POST_INTERVAL_MAX") || process.env.POST_INTERVAL_MAX,
        DEFAULT_POST_INTERVAL_MAX
      ),
      ENABLE_ACTION_PROCESSING: parseBooleanFromText(
        runtime.getSetting("ENABLE_ACTION_PROCESSING") || process.env.ENABLE_ACTION_PROCESSING || "false"
      ) ?? false,
      ACTION_INTERVAL: safeParseInt(
        runtime.getSetting("ACTION_INTERVAL") || process.env.ACTION_INTERVAL,
        5
        // 5 minutes
      ),
      POST_IMMEDIATELY: parseBooleanFromText(
        runtime.getSetting("POST_IMMEDIATELY") || process.env.POST_IMMEDIATELY || "false"
      ) ?? false,
      MAX_ACTIONS_PROCESSING: safeParseInt(
        runtime.getSetting("MAX_ACTIONS_PROCESSING") || process.env.MAX_ACTIONS_PROCESSING,
        1
      ),
      ACTION_TIMELINE_TYPE: runtime.getSetting("ACTION_TIMELINE_TYPE") || process.env.ACTION_TIMELINE_TYPE || ActionTimelineType.ForYou
    };
    return farcasterEnvSchema.parse(farcasterConfig);
  } catch (error) {
    if (error instanceof ZodError) {
      const errorMessages = error.errors.map((err) => `${err.path.join(".")}: ${err.message}`).join("\n");
      throw new Error(
        `Farcaster configuration validation failed:
${errorMessages}`
      );
    }
    throw error;
  }
}

// src/farcaster-client.ts
var FarcasterManager = class {
  client;
  posts;
  interactions;
  signerUuid;
  constructor(runtime, farcasterConfig) {
    const cache = /* @__PURE__ */ new Map();
    this.signerUuid = runtime.getSetting("FARCASTER_NEYNAR_SIGNER_UUID");
    const neynarConfig = new Configuration({
      apiKey: runtime.getSetting("FARCASTER_NEYNAR_API_KEY")
    });
    const neynarClient = new NeynarAPIClient(neynarConfig);
    this.client = new FarcasterClient({
      runtime,
      ssl: true,
      url: runtime.getSetting("FARCASTER_HUB_URL") ?? "hub.pinata.cloud",
      neynar: neynarClient,
      signerUuid: this.signerUuid,
      cache,
      farcasterConfig
    });
    elizaLogger5.success("Farcaster Neynar client initialized.");
    this.posts = new FarcasterPostManager(
      this.client,
      runtime,
      this.signerUuid,
      cache
    );
    this.interactions = new FarcasterInteractionManager(
      this.client,
      runtime,
      this.signerUuid,
      cache
    );
  }
  async start() {
    await Promise.all([this.posts.start(), this.interactions.start()]);
  }
  async stop() {
    await Promise.all([this.posts.stop(), this.interactions.stop()]);
  }
};
var FarcasterClientInterface = {
  name: "farcaster",
  async start(runtime) {
    const farcasterConfig = await validateFarcasterConfig(runtime);
    elizaLogger5.log("Farcaster client started");
    const manager = new FarcasterManager(runtime, farcasterConfig);
    await manager.start();
    return manager;
  }
};

// src/index.ts
var farcasterPlugin = {
  name: "farcaster",
  description: "Farcaster client",
  clients: [FarcasterClientInterface]
};
var index_default = farcasterPlugin;
export {
  index_default as default
};
//# sourceMappingURL=index.js.map