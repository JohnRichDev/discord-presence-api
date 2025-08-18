const DISCORD_UNKNOWN_USER_ERROR_CODE = 10013;

const ACTIVITY_TYPES = {
    0: 'Playing',
    1: 'Streaming',
    2: 'Listening to',
    3: 'Watching',
    4: 'Custom',
    5: 'Competing in'
};

const deepEqual = (obj1, obj2) => {
    if (obj1 === obj2) return true;

    if (obj1 == null || obj2 == null) return obj1 === obj2;

    if (typeof obj1 !== typeof obj2) return false;

    if (typeof obj1 !== 'object') return obj1 === obj2;

    if (Array.isArray(obj1) !== Array.isArray(obj2)) return false;

    const keys1 = Object.keys(obj1);
    const keys2 = Object.keys(obj2);

    if (keys1.length !== keys2.length) return false;

    for (const key of keys1) {
        if (!keys2.includes(key)) return false;
        if (!deepEqual(obj1[key], obj2[key])) return false;
    }

    return true;
};

const getActivityTypeName = (type) => {
    return ACTIVITY_TYPES[type] || 'Unknown';
};

const corsOriginCheck = (origin, callback) => {
    callback(null, true);
};

const getMember = async (guild, userId) => {
    try {
        return guild.members.cache.get(userId) || await guild.members.fetch(userId);
    } catch (error) {
        if (error.code === DISCORD_UNKNOWN_USER_ERROR_CODE || error.status === 404) {
            throw new Error('USER_NOT_FOUND');
        }
        throw error;
    }
};

const formatUserData = (user, member, presence) => {
    const userData = {
        username: user.username,
        displayName: user.globalName,
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

module.exports = {
    DISCORD_UNKNOWN_USER_ERROR_CODE,
    ACTIVITY_TYPES,
    deepEqual,
    getActivityTypeName,
    corsOriginCheck,
    getMember,
    formatUserData
};
