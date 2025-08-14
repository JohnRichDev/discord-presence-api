function setupPresenceHandlers(client, guildId, userDataCache, debouncedSendUserData, debouncedSendActivityData, deepEqual) {
    client.on('presenceUpdate', (oldPresence, newPresence) => {
        if (!newPresence || newPresence.guild.id !== guildId) return;

        const userId = newPresence.userId;
        userDataCache.delete(`user:${userId}`);

        const changes = [];

        if (oldPresence?.status !== newPresence.status) {
            changes.push('status');
        }

        const oldActivities = oldPresence?.activities || [];
        const newActivities = newPresence?.activities || [];

        const oldCustomStatus = oldActivities.find(a => a.type === 4);
        const newCustomStatus = newActivities.find(a => a.type === 4);

        if (!deepEqual(oldCustomStatus, newCustomStatus)) {
            changes.push('customStatus');
        }

        const oldNonCustom = oldActivities.filter(a => a.type !== 4);
        const newNonCustom = newActivities.filter(a => a.type !== 4);

        if (!deepEqual(oldNonCustom, newNonCustom)) {
            changes.push('activities');
        }

        if (changes.length > 0) {
            changes.forEach(changeType => {
                debouncedSendUserData(userId, changeType);
            });
        } else {
            debouncedSendUserData(userId);
        }

        if (!deepEqual(oldPresence?.activities || [], newPresence?.activities || [])) {
            const nonCustomOldActivities = (oldPresence?.activities || []).filter(a => a.type !== 4);
            const nonCustomNewActivities = (newPresence?.activities || []).filter(a => a.type !== 4);

            const oldSpotify = nonCustomOldActivities.find(a => a.name === 'Spotify');
            const newSpotify = nonCustomNewActivities.find(a => a.name === 'Spotify');

            if (!deepEqual(oldSpotify, newSpotify)) {
                debouncedSendActivityData(userId, 'Spotify');
            }

            const allActivityNames = new Set([
                ...nonCustomOldActivities.map(a => a.name),
                ...nonCustomNewActivities.map(a => a.name)
            ]);

            allActivityNames.forEach(activityName => {
                if (activityName !== 'Spotify') {
                    const oldActivity = nonCustomOldActivities.find(a => a.name === activityName);
                    const newActivity = nonCustomNewActivities.find(a => a.name === activityName);

                    if (!deepEqual(oldActivity, newActivity)) {
                        debouncedSendActivityData(userId, activityName);
                    }
                }
            });

            const allActivityTypes = new Set([
                ...nonCustomOldActivities.map(a => a.type),
                ...nonCustomNewActivities.map(a => a.type)
            ]);

            allActivityTypes.forEach(activityType => {
                const oldActivitiesOfType = nonCustomOldActivities.filter(a => a.type === activityType);
                const newActivitiesOfType = nonCustomNewActivities.filter(a => a.type === activityType);

                if (!deepEqual(oldActivitiesOfType, newActivitiesOfType)) {
                    debouncedSendActivityData(userId, null, activityType);
                }
            });
        }
    });

    client.on('userUpdate', (oldUser, newUser) => {
        const userId = newUser.id;
        userDataCache.delete(`user:${userId}`);

        const changes = [];

        if (oldUser.username !== newUser.username) {
            changes.push('username');
        }

        if (oldUser.avatar !== newUser.avatar) {
            changes.push('avatar');
        }

        if (oldUser.globalName !== newUser.globalName) {
            changes.push('displayName');
        }

        if (changes.length > 0) {
            changes.forEach(changeType => {
                debouncedSendUserData(userId, changeType);
            });
        } else {
            debouncedSendUserData(userId, 'all');
        }
    });
}

module.exports = { setupPresenceHandlers };
