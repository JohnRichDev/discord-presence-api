# Discord Bot API Server

A lightweight Express.js server that exposes Discord user status and activity data through RESTful endpoints and real-time WebSocket connections.

## Features

- Retrieve detailed Discord user presence and activity information
- Real-time WebSocket connections for instant presence updates
- Real-time activity-specific subscriptions (e.g., Spotify updates)
- Health check endpoint for monitoring server and bot status
- Subscription-based user monitoring system

## Using the Hosted Version

**Want to use the API without hosting it yourself?**

Join [**The Grid**](https://discord.gg/rA4FWtn9yZ) Discord server to access the hosted version of this API at **https://discord-presence-api.johnrich.dev**! 

Once you're a member of The Grid, you can use the hosted API to get presence data for any user in that server. This is perfect for:
- Testing the API before self-hosting
- Small projects that don't need a dedicated instance
- Learning how the WebSocket integration works

> **Note**: The hosted version only provides data for users who are members of The Grid Discord server.

## API Endpoints

### GET `/`

Returns API information and available endpoints.

### WebSocket Connection

Connect to `ws://localhost:3000` for real-time presence updates.

**WebSocket Events:**

- **Client → Server**: `subscribe(userId)` or `subscribe({ userId, updateTypes })` - Subscribe to user presence updates with optional filtering
- **Client → Server**: `subscribeActivity({ userId, activityName, activityType })` - Subscribe to specific activity updates (e.g., Spotify)
- **Client → Server**: `unsubscribe()` - Unsubscribe from current user
- **Server → Client**: `userUpdate(userData)` - Real-time user data updates
- **Server → Client**: `activityUpdate(activityData)` - Real-time activity-specific updates
- **Server → Client**: `error(message)` - Connection or validation errors

**Update Types for Filtering:**
- `all` - All updates (default)
- `status` - Online status changes (online, idle, dnd, offline)
- `avatar` - Profile picture changes
- `username` - Username or global name changes  
- `activities` - Activity changes (games, apps, etc.)
- `customStatus` - Custom status message changes
- `displayName` - Server display name changes

### GET `/user/:userId`

Returns presence and activity data for the specified Discord user.

**Response includes:**

- Username, display name, and tag
- Online status (online, idle, dnd, offline)
- Avatar and image URLs
- Active applications or activities
- Custom status (with optional emoji)
- Account creation date
- Premium status information

### GET `/health`

Returns current status of the API server and bot.

**Response includes:**

- API and bot connection status
- Server uptime (in seconds)
- Connected guilds and users
- Bot ready time
- WebSocket ping

## Setup Instructions

### Prerequisites

- Node.js 22.0 or later
- A Discord bot token
- A Discord guild (server) ID

### Installation

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd <project-directory>
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create and configure environment variables:
   ```bash
   cp .env.example .env
   ```

   Edit `.env` and update the following values:
   ```env
   DISCORD_BOT_TOKEN=your_discord_bot_token_here
   GUILD_ID=your_server_id_here
   PORT=3000
   ```

### Getting a Discord Bot Token

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application
3. Navigate to the **Bot** section
4. Click **Reset Token** and copy the token
5. Invite the bot to your server with required permissions

### Required Bot Permissions

- View Channels
- Read Message History
- Use Slash Commands (optional)

### Required Bot Intents

Make sure the following Gateway Intents are enabled:

- `GUILDS`
- `GUILD_MEMBERS`
- `GUILD_PRESENCES`

## Usage

### Development

```bash
npm run dev
```

### Production

```bash
npm start
```

The server will run on port `3000` by default (or the value defined in `.env`).

## WebSocket Integration

### Real-time Connection Setup

For real-time updates instead of polling the REST API, connect to the WebSocket server:

```javascript
// Using socket.io-client in your web application
import io from 'socket.io-client';

const socket = io('http://localhost:3000');

// Subscribe to ALL user presence updates (legacy/default behavior)
socket.emit('subscribe', '123456789012345678');

// OR subscribe to specific types of updates only
socket.emit('subscribe', {
  userId: '123456789012345678',
  updateTypes: ['status', 'activities'] // Only get status and activity changes
});

// Listen for real-time updates
socket.on('userUpdate', (userData) => {
  console.log('User status updated:', userData);
  console.log('Update type:', userData.updateType); // Will show what specifically changed
  // Update your UI with new data
});

// Handle connection events
socket.on('connect', () => console.log('Connected to Discord presence server'));
socket.on('disconnect', () => console.log('Disconnected from server'));
socket.on('error', (error) => console.error('WebSocket error:', error));
```

### Advanced Filtering Examples

```javascript
// Only get notified when user goes online/offline/idle/dnd
socket.emit('subscribe', {
  userId: '123456789012345678', 
  updateTypes: ['status']
});

// Only get notified when user changes their profile picture
socket.emit('subscribe', {
  userId: '123456789012345678',
  updateTypes: ['avatar']
});

// Get notified for multiple specific changes
socket.emit('subscribe', {
  userId: '123456789012345678',
  updateTypes: ['status', 'customStatus', 'activities']
});
```

### Activity-Specific Subscriptions

Subscribe to specific activities like Spotify, games, or any application:

```javascript
// Subscribe to Spotify updates only
socket.emit('subscribeActivity', {
  userId: '123456789012345678',
  activityName: 'Spotify'
});

// Subscribe to all listening activities (type 2)
socket.emit('subscribeActivity', {
  userId: '123456789012345678',
  activityType: 2
});

// Subscribe to all gaming activities (type 0)
socket.emit('subscribeActivity', {
  userId: '123456789012345678',
  activityType: 0
});

// Listen for activity-specific updates
socket.on('activityUpdate', (activityData) => {
  console.log('Activity update:', activityData);
  // activityData contains: userId, username, displayName, status, activities[], timestamp
  
  if (activityData.activities.length > 0) {
    console.log('Current activities:', activityData.activities);
  } else {
    console.log('No matching activities found');
  }
});
```

**Activity Types:**
- `0` - Playing (games, applications)
- `1` - Streaming
- `2` - Listening to (Spotify, music)
- `3` - Watching (videos, streams)
- `5` - Competing in (tournaments, competitions)

## Example API Usage

### Get User Information

```bash
curl http://localhost:3000/user/123456789012345678
```

**Sample Response:**
```json
{
  "username": "johnrich",
  "globalName": "John Rich",
  "displayName": "John Rich",
  "tag": "johnrich",
  "id": "150471906536062976",
  "status": "idle",
  "avatarUrl": "https://cdn.discordapp.com/avatars/150471906536062976/91259f5eb1f557df7c213730cd639a66.webp?size=512",
  "customStatus": {
    "emoji": {
      "name": "central",
      "id": "1130007884512624641",
      "animated": true
    },
    "state": "test"
  },
  "activities": [
    {
      "name": "Spotify",
      "type": 2,
      "typeName": "Listening to",
      "details": "Peaches (feat. Daniel Caesar & Giveon)",
      "state": "Justin Bieber; Daniel Caesar; GIVĒON",
      "timestamps": {
        "start": "2025-08-03T16:33:19.225Z",
        "end": "2025-08-03T16:36:37.306Z"
      },
      "applicationId": null,
      "url": null,
      "artist": "Justin Bieber; Daniel Caesar; GIVĒON",
      "song": "Peaches (feat. Daniel Caesar & Giveon)",
      "album": "Justice",
      "albumArt": "https://i.scdn.co/image/ab67616d0000b273e6f407c7f3a0ec98845e4431"
    },
    {
      "name": "Visual Studio Code",
      "type": 0,
      "typeName": "Playing",
      "details": "Editing page.tsx",
      "state": "Workspace: johnrich.dev",
      "timestamps": {
        "start": "2025-08-03T08:10:22.046Z",
        "end": null
      },
      "applicationId": "383226320970055681",
      "url": null
    }
  ],
  "createdAt": 1455945698151,
  "flags": [
    "HypeSquadOnlineHouse2",
    "ActiveDeveloper"
  ],
  "premiumSince": 1750607849835
}
```

### Health Check

```bash
curl http://localhost:3000/health
```

**Sample Response:**
```json
{
  "status": "online",
  "botStatus": "online",
  "uptime": 73,
  "guilds": 1,
  "users": 89,
  "version": "14.21.0",
  "readyAt": "2025-08-03T16:02:59.066Z",
  "ping": 279,
  "memory": {
    "used": 19,
    "total": 22
  }
}
```

## Error Handling

### REST API Errors

- `404 Not Found`: User not found in the guild
- `500 Internal Server Error`: Unexpected server error
- `503 Service Unavailable`: Bot is not connected or not ready

### WebSocket Connection Issues

- **Invalid User ID**: WebSocket will emit error event with validation message
- **User Not Found**: Bot cannot find user in the configured guild
- **Connection Lost**: Client should implement reconnection logic
- **CORS Issues**: Ensure `CORS_ORIGIN` environment variable includes your domain

## Dependencies

- `discord.js`: Discord API client
- `express`: Web server framework
- `socket.io`: Real-time WebSocket communication
- `dotenv`: Environment variable loader

## Contributing

1. Fork this repository
2. Create a feature branch
3. Make changes and test them
4. Submit a pull request

## License

Licensed under the ISC License. You may use this software for personal or commercial purposes.

## Support

If you encounter issues:

1. Check the existing GitHub issues
2. Create a new issue with relevant details
3. Include configuration and error logs where applicable