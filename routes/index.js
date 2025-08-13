const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();

function initializeRoutes(deps) {
    const {
        client,
        isOptedOut,
        getGuild,
        getMember,
        formatUserData,
        userDataCache,
        CACHE_TTL
    } = deps;

    const limiter = rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 100,
        message: {
            error: 'Too many requests',
            details: 'Please try again later'
        },
        standardHeaders: true,
        legacyHeaders: false,
    });

    router.use('/user', limiter);

    router.get('/', (req, res) => {
        res.json({
            name: 'Discord Presence API',
            version: '1.0.0',
            description: 'Discord bot API server that provides user status and activity information',
            endpoints: {
                health: '/health',
                user: '/user/:userId'
            },
            websocket: {
                events: {
                    subscribe: 'Subscribe to user updates with optional filters',
                    subscribeActivity: 'Subscribe to specific activity updates (e.g., Spotify)',
                    unsubscribe: 'Unsubscribe from user updates',
                    userUpdate: 'Receive user data updates',
                    activityUpdate: 'Receive activity-specific updates',
                    error: 'Receive error messages'
                },
                updateTypes: ['all', 'status', 'avatar', 'username', 'activities', 'customStatus', 'displayName'],
                activitySubscription: {
                    description: 'Subscribe to specific activity updates',
                    parameters: {
                        userId: 'Discord user ID (required)',
                        activityName: 'Name of the activity to monitor (e.g., "Spotify")',
                        activityType: 'Type of activity to monitor (0=Playing, 1=Streaming, 2=Listening, 3=Watching, 5=Competing)'
                    },
                    examples: [
                        {
                            description: 'Subscribe to Spotify updates',
                            data: { userId: '123456789012345678', activityName: 'Spotify' }
                        },
                        {
                            description: 'Subscribe to all listening activities',
                            data: { userId: '123456789012345678', activityType: 2 }
                        }
                    ]
                }
            }
        });
    });

    router.get('/user/:userId', async (req, res) => {
        const { userId } = req.params;

        if (!/^\d{17,19}$/.test(userId)) {
            return res.status(400).json({
                error: 'Invalid user ID format',
                details: 'User ID must be a valid Discord snowflake (17-19 digits)'
            });
        }

        if (isOptedOut(userId)) {
            return res.status(403).json({
                error: 'User has opted out of API exposure',
                details: 'This user has chosen not to share their presence/activity via the API.'
            });
        }

        if (!client.isReady()) {
            return res.status(503).json({
                error: 'Bot is not ready yet',
                details: 'Please wait for the bot to connect to Discord'
            });
        }

        try {
            const cacheKey = `user:${userId}`;
            const now = Date.now();
            const cached = userDataCache.get(cacheKey);

            if (cached && (now - cached.timestamp) < CACHE_TTL) {
                return res.json(cached.data);
            }

            const guild = await getGuild();
            const member = await getMember(guild, userId);
            const user = member.user;
            const presence = guild.presences.cache.get(userId);

            const response = formatUserData(user, member, presence);

            userDataCache.set(cacheKey, {
                data: response,
                timestamp: now
            });

            res.json(response);

        } catch (error) {
            console.error('Error fetching user:', error);

            if (error.message === 'USER_NOT_FOUND') {
                return res.status(404).json({
                    error: 'Member not found in this guild',
                    details: 'User may not be a member of the specified guild'
                });
            }

            res.status(500).json({
                error: 'User not found or error occurred',
                details: error.message
            });
        }
    });

    router.get('/health', (() => {
        let healthDataCache = null;
        let healthCacheTimestamp = 0;
        const HEALTH_CACHE_TTL = 30 * 1000;

        return (req, res) => {
            const now = Date.now();

            if (healthDataCache && (now - healthCacheTimestamp) < HEALTH_CACHE_TTL) {
                return res.json(healthDataCache);
            }

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

            healthDataCache = healthData;
            healthCacheTimestamp = now;

            res.json(healthData);
        };
    })());

    router.use((err, req, res, next) => {
        console.error('Unhandled error:', err);
        res.status(500).json({
            error: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? err.message : 'An unexpected error occurred'
        });
    });

    router.use((req, res) => {
        res.status(404).json({
            error: 'Endpoint not found',
            details: `The endpoint ${req.method} ${req.path} does not exist`
        });
    });

    return router;
}

module.exports = initializeRoutes;
