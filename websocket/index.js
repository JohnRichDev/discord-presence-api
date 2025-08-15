const { Server } = require('socket.io');
const { createConnectionHandler, setupSocketEventHandlers } = require('./handlers');

let io;
const clientSubscriptions = new Map();
const clientUpdateFilters = new Map();
const updateDebounceMap = new Map();
const DEBOUNCE_DELAY = 1000;

const initializeWebSocketServer = (server, dependencies) => {
    const {
        isOptedOut,
        getGuild,
        getMember,
        formatUserData,
        userDataCache,
        CACHE_TTL,
        deepEqual
    } = dependencies;

    const corsOriginCheck = (origin, callback) => {
        callback(null, true);
    };

    io = new Server(server, {
        cors: {
            origin: corsOriginCheck,
            methods: ["GET", "POST"]
        }
    });

    const getActivityTypeName = (type) => {
        const ACTIVITY_TYPES = {
            0: 'Playing',
            1: 'Streaming',
            2: 'Listening to',
            3: 'Watching',
            4: 'Custom',
            5: 'Competing in'
        };
        return ACTIVITY_TYPES[type] || 'Unknown';
    };

    const sendUserData = async (userId, socket = null, updateType = null) => {
        try {
            const cacheKey = `user:${userId}`;
            const now = Date.now();
            const cached = userDataCache.get(cacheKey);

            if (cached && (now - cached.timestamp) < CACHE_TTL) {
                if (socket) {
                    socket.emit('userUpdate', cached.data);
                } else {
                    emitToSubscribedClients(userId, cached.data, updateType);
                }
                return;
            }

            const guild = await getGuild();
            const member = await getMember(guild, userId);
            const user = member.user;
            const presence = guild.presences.cache.get(userId);

            const userData = formatUserData(user, member, presence);

            userDataCache.set(cacheKey, {
                data: userData,
                timestamp: now
            });

            if (socket) {
                socket.emit('userUpdate', userData);
            } else {
                emitToSubscribedClients(userId, userData, updateType);
            }
        } catch (error) {
            console.error(`Error sending user data for ${userId}:`, error.message);

            if (socket) {
                if (error.message === 'USER_NOT_FOUND') {
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

    const sendActivityData = async (userId, socket = null, activityName = null, activityType = null) => {
        try {
            const cacheKey = `user:${userId}`;
            const now = Date.now();
            const cached = userDataCache.get(cacheKey);

            let userData;
            if (cached && (now - cached.timestamp) < CACHE_TTL) {
                userData = cached.data;
            } else {
                const guild = await getGuild();
                const member = await getMember(guild, userId);
                const user = member.user;
                const presence = guild.presences.cache.get(userId);
                userData = formatUserData(user, member, presence);
            }

            let filteredActivities = userData.activities;
            if (activityName) {
                filteredActivities = userData.activities.filter(activity =>
                    activity.name.toLowerCase() === activityName.toLowerCase()
                );
            } else if (activityType !== undefined) {
                filteredActivities = userData.activities.filter(activity =>
                    activity.type === activityType
                );
            }

            const activityData = {
                userId: userData.id,
                username: userData.username,
                displayName: userData.displayName,
                status: userData.status,
                activities: filteredActivities,
                timestamp: Date.now()
            };

            if (socket) {
                socket.emit('activityUpdate', activityData);
            } else {
                emitToActivitySubscribers(userId, activityData, activityName, activityType);
            }
        } catch (error) {
            console.error(`Error sending activity data for ${userId}:`, error.message);

            if (socket) {
                if (error.message === 'USER_NOT_FOUND') {
                    socket.emit('error', {
                        message: 'User not found in this guild',
                        code: 'USER_NOT_FOUND',
                        userId: userId
                    });
                } else {
                    socket.emit('error', {
                        message: 'Failed to fetch activity data',
                        code: 'FETCH_ERROR',
                        userId: userId
                    });
                }
            }
        }
    };

    const emitToSubscribedClients = (userId, userData, updateType = null) => {
        if (isOptedOut(userId)) return;
        const room = io.sockets.adapter.rooms.get(`user:${userId}`);
        if (room) {
            room.forEach(socketId => {
                const clientSocket = io.sockets.sockets.get(socketId);
                const updateFilters = clientUpdateFilters.get(socketId);
                if (clientSocket && updateFilters) {
                    if (updateFilters.includes('all') || (updateType && updateFilters.includes(updateType))) {
                        clientSocket.emit('userUpdate', {
                            ...userData,
                            updateType: updateType || 'all'
                        });
                    }
                }
            });
        }
    };

    const emitToActivitySubscribers = (userId, activityData, activityName = null, activityType = null) => {
        const subscriptionKey = `${userId}:${activityName || `type:${activityType}`}`;
        const room = io.sockets.adapter.rooms.get(`activity:${subscriptionKey}`);

        if (room) {
            room.forEach(socketId => {
                const clientSocket = io.sockets.sockets.get(socketId);
                if (clientSocket) {
                    clientSocket.emit('activityUpdate', activityData);
                }
            });
        }
    };

    const debouncedSendUserData = (userId, updateType = null) => {
        const key = `${userId}:${updateType || 'all'}`;
        if (updateDebounceMap.has(key)) {
            clearTimeout(updateDebounceMap.get(key));
        }

        const timeoutId = setTimeout(() => {
            sendUserData(userId, null, updateType);
            updateDebounceMap.delete(key);
        }, DEBOUNCE_DELAY);

        updateDebounceMap.set(key, timeoutId);
    };

    const debouncedSendActivityData = (userId, activityName = null, activityType = null) => {
        const key = `activity:${userId}:${activityName || `type:${activityType}`}`;
        if (updateDebounceMap.has(key)) {
            clearTimeout(updateDebounceMap.get(key));
        }

        const timeoutId = setTimeout(() => {
            sendActivityData(userId, null, activityName, activityType);
            updateDebounceMap.delete(key);
        }, DEBOUNCE_DELAY);

        updateDebounceMap.set(key, timeoutId);
    };

    io.on('connection', (socket) => {
        const handlers = createConnectionHandler({
            isOptedOut,
            getGuild,
            getMember,
            sendUserData,
            sendActivityData,
            clientSubscriptions,
            clientUpdateFilters
        });

        setupSocketEventHandlers(socket, handlers);
    });

    return {
        debouncedSendUserData,
        debouncedSendActivityData,
        sendUserData,
        sendActivityData,
        emitToSubscribedClients,
        emitToActivitySubscribers
    };
};

const getWebSocketServer = () => io;

module.exports = {
    initializeWebSocketServer,
    getWebSocketServer
};
