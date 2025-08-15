const {
    validateSubscriptionData,
    validateUpdateTypes,
    validateActivitySubscription,
    createSubscriptionKey,
    formatErrorResponse,
    logClientSubscription,
    logActivitySubscription,
    logClientUnsubscribe,
    logClientDisconnect
} = require('./utils');

const createConnectionHandler = (dependencies) => {
    const {
        isOptedOut,
        getGuild,
        getMember,
        sendUserData,
        sendActivityData,
        clientSubscriptions,
        clientUpdateFilters
    } = dependencies;

    const handleSubscribe = async (socket, data) => {
        const validation = validateSubscriptionData(data);

        if (!validation.valid) {
            socket.emit('error', formatErrorResponse(
                'Invalid subscription data format',
                'INVALID_FORMAT'
            ));
            return;
        }

        const { userId, updateTypes } = validation;

        if (isOptedOut(userId)) {
            socket.emit('error', formatErrorResponse(
                'This user has opted out of API exposure.',
                'USER_OPTED_OUT',
                { userId }
            ));
            return;
        }

        const updateTypesValidation = validateUpdateTypes(updateTypes);
        if (!updateTypesValidation.valid) {
            socket.emit('error', formatErrorResponse(
                `Invalid update types: ${updateTypesValidation.invalidTypes.join(', ')}`,
                'INVALID_UPDATE_TYPES',
                { validTypes: updateTypesValidation.validTypes }
            ));
            return;
        }

        try {
            const guild = await getGuild();
            const member = await getMember(guild, userId);

            clientSubscriptions.set(socket.id, userId);
            clientUpdateFilters.set(socket.id, updateTypes);
            socket.join(`user:${userId}`);
            logClientSubscription(socket.id, userId, updateTypes);

            sendUserData(userId, socket);
        } catch (error) {
            if (error.message === 'USER_NOT_FOUND') {
                socket.emit('error', formatErrorResponse(
                    'User not found in this guild',
                    'USER_NOT_FOUND',
                    { userId }
                ));
            } else {
                socket.emit('error', formatErrorResponse(
                    'Failed to validate user',
                    'VALIDATION_ERROR',
                    { userId }
                ));
            }
            console.error(`Failed to subscribe client ${socket.id} to user ${userId}:`, error.message);
        }
    };

    const handleActivitySubscribe = async (socket, data) => {
        const validation = validateActivitySubscription(data);

        if (!validation.valid) {
            socket.emit('error', formatErrorResponse(
                validation.error,
                'INVALID_FORMAT',
                { userId: data.userId }
            ));
            return;
        }

        const { userId, activityName, activityType } = data;

        try {
            const subscriptionKey = createSubscriptionKey(userId, activityName, activityType);
            clientSubscriptions.set(socket.id, subscriptionKey);
            clientUpdateFilters.set(socket.id, {
                userId,
                activityName,
                activityType,
                type: 'activity'
            });

            socket.join(`activity:${subscriptionKey}`);
            logActivitySubscription(socket.id, userId, activityName, activityType);

            sendActivityData(userId, socket, activityName, activityType);
        } catch (error) {
            if (error.message === 'USER_NOT_FOUND') {
                socket.emit('error', formatErrorResponse(
                    'User not found in this guild',
                    'USER_NOT_FOUND',
                    { userId }
                ));
            } else {
                socket.emit('error', formatErrorResponse(
                    'Failed to validate user',
                    'VALIDATION_ERROR',
                    { userId }
                ));
            }
            console.error(`Failed to subscribe client ${socket.id} to activity updates for user ${userId}:`, error.message);
        }
    };

    const handleUnsubscribe = (socket) => {
        const userId = clientSubscriptions.get(socket.id);
        if (userId) {
            socket.leave(`user:${userId}`);
            clientSubscriptions.delete(socket.id);
            clientUpdateFilters.delete(socket.id);
            logClientUnsubscribe(socket.id, userId);
        }
    };

    const handleDisconnect = (socket) => {
        const subscription = clientSubscriptions.get(socket.id);
        const filter = clientUpdateFilters.get(socket.id);

        if (subscription) {
            const isActivitySubscription = filter && filter.type === 'activity';
            logClientDisconnect(socket.id, isActivitySubscription);

            clientSubscriptions.delete(socket.id);
            clientUpdateFilters.delete(socket.id);
        } else {
            logClientDisconnect(socket.id);
        }
    };

    return {
        handleSubscribe,
        handleActivitySubscribe,
        handleUnsubscribe,
        handleDisconnect
    };
};

const setupSocketEventHandlers = (socket, handlers) => {
    console.log(`Client connected: ${socket.id}`);

    socket.on('subscribe', (data) => handlers.handleSubscribe(socket, data));
    socket.on('subscribeActivity', (data) => handlers.handleActivitySubscribe(socket, data));
    socket.on('unsubscribe', () => handlers.handleUnsubscribe(socket));
    socket.on('disconnect', () => handlers.handleDisconnect(socket));
};

module.exports = {
    createConnectionHandler,
    setupSocketEventHandlers
};
