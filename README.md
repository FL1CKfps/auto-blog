# Auto-Blog Server

This is a standalone Node.js server that handles automatic blog post generation on a schedule. The server manages posting schedules and communicates with your Firebase database to store configuration and create blog posts.

## How It Works

The server runs continuously and:
1. Creates blog posts on a schedule (every minute for news, or at custom intervals for regular posts)
2. Persists configuration in Firebase
3. Exposes API endpoints for controlling the auto-posting features

## Setup Instructions

### 1. Install Dependencies

Navigate to the server directory and install dependencies:

```bash
cd server
npm install
```

### 2. Configure Environment Variables

Create a `.env` file in the server directory with your actual credentials:

```bash
# Copy the example file
cp .env.example .env

# Edit the .env file with your details
nano .env  # or use any text editor
```

Fill in these values in your `.env` file:
- `API_SECRET`: A secret key you create for API security
- `UNSPLASH_ACCESS_KEY`: Your Unsplash API key
- `GEMINI_API_KEY`: Your Gemini API key
- All the Firebase config values from your Firebase console

### 3. Run the Server

For development:
```bash
npm run dev
```

For production:
```bash
npm start
```

## Keeping the Server Running 24/7

### Option 1: Run on Your Computer (Not Recommended for Production)

The server needs to run continuously. If you're just testing, you can:
- Run it in a terminal window on your computer
- The downside is that posts will only be created when your computer is on

### Option 2: Deploy to a Hosting Service (Recommended)

For 24/7 operation, deploy to a hosting service:

#### Heroku
1. Create a Heroku account
2. Install Heroku CLI
3. Create a Heroku app: `heroku create your-app-name`
4. Add config vars in Heroku dashboard
5. Deploy: `git push heroku main`

#### Railway
1. Sign up at [Railway.app](https://railway.app)
2. Create a new project and select "Deploy from GitHub"
3. Connect to your GitHub repo
4. Add environment variables in Railway dashboard

#### Render
1. Sign up at [Render.com](https://render.com)
2. Create a new Web Service
3. Connect to your GitHub repo
4. Add environment variables in Render dashboard

## Connecting Your Next.js App

In your Next.js app's `auto-blog-control.tsx` component, update the API calls to point to your server:

```js
// Update the updateServerConfig function
const updateServerConfig = async (updates) => {
  try {
    const response = await fetch(`http://your-server-url/api/config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-secret': 'YOUR_API_SECRET' // Same as in server .env
      },
      body: JSON.stringify(updates),
    });
    
    const data = await response.json();
    
    if (data.success) {
      // Update local state
      return true;
    } else {
      throw new Error(data.error || 'Failed to update configuration');
    }
  } catch (error) {
    console.error('Error updating server config:', error);
    throw error;
  }
};
```

## API Endpoints

The server exposes these endpoints:

- `GET /api/config` - Get current auto-blog configuration
- `POST /api/config` - Update configuration and start/stop schedules
- `POST /api/create-post` - Manually create a blog post
- `POST /api/webhook` - Webhook for Next.js app to control the server

## Troubleshooting

1. **Posts aren't being created:**
   - Check server logs for errors
   - Verify that Firebase credentials are correct
   - Make sure Gemini and Unsplash API keys are valid

2. **Server stops running:**
   - Use a process manager like PM2 or Forever
   - Consider a hosting service that handles this for you

3. **Next.js app can't connect to server:**
   - Check the server URL in your Next.js code
   - Verify that CORS is not blocking the requests
   - Make sure the API_SECRET matches in both places 