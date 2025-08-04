require('dotenv').config();
const express = require('express');
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const { createServer } = require('http');
const { Server } = require('socket.io');

const GUILD_ID = process.env.GUILD_ID;
const PORT = process.env.PORT || 3000;

const ACTIVITY_TYPES = {
    0: 'Playing',
    1: 'Streaming',
    2: 'Listening to',
    3: 'Watching',
    4: 'Custom',
    5: 'Competing in'
};

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildPresences,
    ],
    partials: [
        Partials.User,
        Partials.GuildMember
    ]
});

const app = express();
const server = createServer(app);
const io = new Server(server, {
    cors: {
        origin: process.env.CORS_ORIGIN || "http://localhost:3000",
        methods: ["GET", "POST"]
    }
});

const clientSubscriptions = new Map();

app.use(express.json({ limit: '10mb' }));

if (process.env.NODE_ENV !== 'production') {
    app.use((req, res, next) => {
        console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
        next();
    });
}

client.once('ready', () => {
    console.log(`Bot logged in as ${client.user.tag}`);
    console.log(`Connected to ${client.guilds.cache.size} guild(s)`);
    console.log(`Cached ${client.users.cache.size} user(s)`);
    console.log('Bot is ready!');
});

io.on('connection', (socket) => {
    console.log(`Client connected: ${socket.id}`);

    socket.on('subscribe', async (userId) => {
        if (!/^\d{17,19}$/.test(userId)) {
            socket.emit('error', {
                message: 'Invalid user ID format',
                code: 'INVALID_FORMAT',
                userId: userId
            });
            return;
        }

        try {
            const guild = client.guilds.cache.get(GUILD_ID) || await client.guilds.fetch(GUILD_ID);
            const member = guild.members.cache.get(userId) || await guild.members.fetch(userId);

            clientSubscriptions.set(socket.id, userId);
            socket.join(`user:${userId}`);
            console.log(`Client ${socket.id} subscribed to user ${userId}`);

            sendUserData(userId, socket);
        } catch (error) {
            if (error.code === 10013 || error.status === 404) {
                socket.emit('error', {
                    message: 'User not found in this guild',
                    code: 'USER_NOT_FOUND',
                    userId: userId
                });
            } else {
                socket.emit('error', {
                    message: 'Failed to validate user',
                    code: 'VALIDATION_ERROR',
                    userId: userId
                });
            }
            console.error(`Failed to subscribe client ${socket.id} to user ${userId}:`, error.message);
        }
    });

    socket.on('unsubscribe', () => {
        const userId = clientSubscriptions.get(socket.id);
        if (userId) {
            socket.leave(`user:${userId}`);
            clientSubscriptions.delete(socket.id);
            console.log(`Client ${socket.id} unsubscribed from user ${userId}`);
        }
    });

    socket.on('disconnect', () => {
        const userId = clientSubscriptions.get(socket.id);
        if (userId) {
            clientSubscriptions.delete(socket.id);
        }
        console.log(`Client disconnected: ${socket.id}`);
    });
});

const formatUserData = (user, member, presence) => {
    const userData = {
        username: user.username,
        globalName: user.globalName,
        displayName: member.displayName,
        tag: user.tag,
        id: user.id,
        status: presence?.status || 'offline',
        avatarUrl: user.displayAvatarURL({ dynamic: true, size: 512 }),
        customStatus: null,
        activities: [],
        createdAt: user.createdTimestamp,
        flags: user.flags?.toArray() || [],
        premiumSince: member.premiumSinceTimestamp,
    };

    if (presence?.activities?.length > 0) {
        const customStatusActivity = presence.activities.find(a => a.type === 4);
        if (customStatusActivity && !userData.customStatus) {
            userData.customStatus = {
                emoji: customStatusActivity.emoji ? {
                    name: customStatusActivity.emoji.name,
                    id: customStatusActivity.emoji.id,
                    animated: customStatusActivity.emoji.animated || false
                } : null,
                state: customStatusActivity.state
            };
        }

        userData.activities = presence.activities
            .filter(activity => activity.type !== 4)
            .map(activity => {
                const baseActivity = {
                    name: activity.name,
                    type: activity.type,
                    typeName: getActivityTypeName(activity.type),
                    details: activity.details || null,
                    state: activity.state || null,
                    timestamps: activity.timestamps ? {
                        start: activity.timestamps.start,
                        end: activity.timestamps.end
                    } : null,
                    applicationId: activity.applicationId || null,
                    url: activity.url || null
                };

                if (activity.name === 'Spotify' && activity.type === 2) {
                    baseActivity.artist = activity.state;
                    baseActivity.song = activity.details;
                    baseActivity.album = activity.assets?.largeText || null;
                    baseActivity.albumArt = activity.assets?.largeImage ?
                        `https://i.scdn.co/image/${activity.assets.largeImage.replace('spotify:', '')}` : null;
                }

                return baseActivity;
            });
    }

    return userData;
};

const sendUserData = async (userId, socket = null) => {
    try {
        const guild = client.guilds.cache.get(GUILD_ID) || await client.guilds.fetch(GUILD_ID);
        const member = guild.members.cache.get(userId) || await guild.members.fetch(userId);
        const user = member.user;
        const presence = guild.presences.cache.get(userId);

        const userData = formatUserData(user, member, presence);

        if (socket) {
            socket.emit('userUpdate', userData);
        } else {
            io.to(`user:${userId}`).emit('userUpdate', userData);
        }
    } catch (error) {
        console.error(`Error sending user data for ${userId}:`, error.message);

        if (socket) {
            if (error.code === 10013 || error.status === 404) {
                socket.emit('error', {
                    message: 'User not found in this guild',
                    code: 'USER_NOT_FOUND',
                    userId: userId
                });
            } else {
                socket.emit('error', {
                    message: 'Failed to fetch user data',
                    code: 'FETCH_ERROR',
                    userId: userId
                });
            }
        }
    }
};

client.on('presenceUpdate', (oldPresence, newPresence) => {
    if (!newPresence || newPresence.guild.id !== GUILD_ID) return;

    const userId = newPresence.userId;
    if (io.sockets.adapter.rooms.has(`user:${userId}`)) {
        sendUserData(userId);
    }
});

client.on('userUpdate', (oldUser, newUser) => {
    const userId = newUser.id;
    if (io.sockets.adapter.rooms.has(`user:${userId}`)) {
        sendUserData(userId);
    }
});

client.on('guildMemberUpdate', (oldMember, newMember) => {
    if (newMember.guild.id !== GUILD_ID) return;

    const userId = newMember.id;
    if (io.sockets.adapter.rooms.has(`user:${userId}`)) {
        sendUserData(userId);
    }
});

const getActivityTypeName = (type) => ACTIVITY_TYPES[type] || 'Unknown';

app.get('/user/:userId', async (req, res) => {
    const { userId } = req.params;

    if (!/^\d{17,19}$/.test(userId)) {
        return res.status(400).json({
            error: 'Invalid user ID format',
            details: 'User ID must be a valid Discord snowflake (17-19 digits)'
        });
    }

    if (!client.isReady()) {
        return res.status(503).json({
            error: 'Bot is not ready yet',
            details: 'Please wait for the bot to connect to Discord'
        });
    }

    try {
        const guild = client.guilds.cache.get(GUILD_ID) || await client.guilds.fetch(GUILD_ID);

        let member;
        try {
            member = guild.members.cache.get(userId) || await guild.members.fetch(userId);
        } catch (fetchError) {
            return res.status(404).json({
                error: 'Member not found in this guild',
                details: 'User may not be a member of the specified guild'
            });
        }

        const user = member.user;
        const presence = guild.presences.cache.get(userId);

        const response = formatUserData(user, member, presence);

        res.json(response);

    } catch (error) {
        console.error('Error fetching user:', error);
        res.status(500).json({
            error: 'User not found or error occurred',
            details: error.message
        });
    }
});

app.get('/health', (req, res) => {
    const healthData = {
        status: 'online',
        botStatus: client.user?.presence?.status || 'offline',
        uptime: Math.floor(process.uptime()),
        guilds: client.guilds.cache.size,
        users: client.users.cache.size,
        version: require('discord.js').version,
        readyAt: client.readyAt,
        ping: client.ws.ping,
        memory: {
            used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
            total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024)
        }
    };

    res.json(healthData);
});

app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? err.message : 'An unexpected error occurred'
    });
});

app.use((req, res) => {
    res.status(404).json({
        error: 'Endpoint not found',
        details: `The endpoint ${req.method} ${req.path} does not exist`
    });
});

client.on('error', error => {
    console.error('Discord client error:', error);
});

client.on('invalidated', () => {
    console.error('Session invalidated! Bot token may be invalid.');
});

client.on('disconnect', () => {
    console.warn('Disconnected from Discord');
});

client.on('reconnecting', () => {
    console.log('Reconnecting to Discord...');
});

const gracefulShutdown = () => {
    console.log('Received shutdown signal, cleaning up...');

    server.close(() => {
        console.log('HTTP server closed');

        client.destroy();
        console.log('Discord client destroyed');

        process.exit(0);
    });
};

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

process.on('unhandledRejection', (error) => {
    console.error('Unhandled promise rejection:', error);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error);
    gracefulShutdown();
});

server.listen(PORT, () => {
    console.log(`Discord Bot API server is running on port ${PORT}`);
    console.log(`Health check available at: http://localhost:${PORT}/health`);
    console.log(`User endpoint available at: http://localhost:${PORT}/user/:userId`);
    console.log(`WebSocket server is running on the same port`);
});

client.login(process.env.DISCORD_BOT_TOKEN).catch(error => {
    console.error('Failed to login to Discord:', error);
    process.exit(1);
});