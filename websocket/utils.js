const validateUserId = (userId) => {
    return /^\d{17,19}$/.test(userId);
};

const validateSubscriptionData = (data) => {
    if (typeof data === 'string') {
        return {
            userId: data,
            updateTypes: ['all'],
            valid: validateUserId(data)
        };
    } else if (typeof data === 'object' && data.userId) {
        return {
            userId: data.userId,
            updateTypes: data.updateTypes || ['all'],
            valid: validateUserId(data.userId)
        };
    }
    return { valid: false };
};

const validateUpdateTypes = (updateTypes) => {
    const validUpdateTypes = ['all', 'status', 'avatar', 'username', 'activities', 'customStatus', 'displayName'];
    const invalidTypes = updateTypes.filter(type => !validUpdateTypes.includes(type));

    return {
        valid: invalidTypes.length === 0,
        invalidTypes,
        validTypes: validUpdateTypes
    };
};

const validateActivitySubscription = (data) => {
    const { userId, activityName, activityType } = data;

    if (!userId || !validateUserId(userId)) {
        return { valid: false, error: 'Invalid user ID format' };
    }

    if (!activityName && activityType === undefined) {
        return { valid: false, error: 'Either activityName or activityType must be specified' };
    }

    return { valid: true };
};

const createSubscriptionKey = (userId, activityName = null, activityType = null) => {
    return `${userId}:${activityName || `type:${activityType}`}`;
};

const formatErrorResponse = (message, code, additionalData = {}) => {
    return {
        message,
        code,
        ...additionalData
    };
};

const createCacheKey = (userId, prefix = 'user') => {
    return `${prefix}:${userId}`;
};

const isCacheExpired = (cached, ttl) => {
    if (!cached) return true;
    const now = Date.now();
    return (now - cached.timestamp) > ttl;
};

const filterActivitiesByName = (activities, activityName) => {
    return activities.filter(activity =>
        activity.name.toLowerCase() === activityName.toLowerCase()
    );
};

const filterActivitiesByType = (activities, activityType) => {
    return activities.filter(activity =>
        activity.type === activityType
    );
};

const createActivityData = (userData, filteredActivities) => {
    return {
        userId: userData.id,
        username: userData.username,
        displayName: userData.displayName,
        status: userData.status,
        activities: filteredActivities,
        timestamp: Date.now()
    };
};

const shouldUpdateClient = (updateFilters, updateType) => {
    return updateFilters.includes('all') || (updateType && updateFilters.includes(updateType));
};

const createUserUpdateData = (userData, updateType = null) => {
    return {
        ...userData,
        updateType: updateType || 'all'
    };
};

const logClientSubscription = (socketId, userId, updateTypes) => {
    console.log(`Client ${socketId} subscribed to user ${userId} with filters: ${updateTypes.join(', ')}`);
};

const logActivitySubscription = (socketId, userId, activityName, activityType) => {
    console.log(`Client ${socketId} subscribed to activity updates for user ${userId} - ${activityName || `type ${activityType}`}`);
};

const logClientUnsubscribe = (socketId, userId) => {
    console.log(`Client ${socketId} unsubscribed from user ${userId}`);
};

const logClientDisconnect = (socketId, isActivitySubscription = false) => {
    const subscriptionType = isActivitySubscription ? ' (was subscribed to activity updates)' : '';
    console.log(`Client disconnected: ${socketId}${subscriptionType}`);
};

module.exports = {
    validateUserId,
    validateSubscriptionData,
    validateUpdateTypes,
    validateActivitySubscription,
    createSubscriptionKey,
    formatErrorResponse,
    createCacheKey,
    isCacheExpired,
    filterActivitiesByName,
    filterActivitiesByType,
    createActivityData,
    shouldUpdateClient,
    createUserUpdateData,
    logClientSubscription,
    logActivitySubscription,
    logClientUnsubscribe,
    logClientDisconnect
};
