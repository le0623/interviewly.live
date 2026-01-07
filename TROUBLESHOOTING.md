# Troubleshooting WebRTC Connection Issues

## Common Error: "WebRTC error: websocket error"

### Root Causes

1. **Server Not Running** (Most Common)
   - The unified server (Next.js + SFU) runs on port 3000 by default
   - If the server isn't running, the WebSocket connection will fail

2. **Wrong SFU URL Configuration**
   - The client uses `NEXT_PUBLIC_SFU_URL` environment variable
   - Default is `http://localhost:3000` (same port as the Next.js app)

3. **Port Conflicts**
   - Another service might be using port 3000
   - Check with: `netstat -ano | findstr :3000` (Windows) or `lsof -i :3000` (Mac/Linux)

### Solutions

#### 1. Start the Server

The application uses a unified server that runs both Next.js and the SFU server:

```bash
npm run dev
```

**Note:** The server runs both services on the same port (3000 by default). You don't need to start them separately.

#### 2. Check Server Status

When the server starts successfully, you should see:
```
🚀 Next.js app running on http://localhost:3000
🚀 SFU Server running on port 3000 (same server)
📡 WebSocket signaling available at ws://localhost:3000/socket.io
💡 SFU URL: http://localhost:3000
```

#### 3. Verify Environment Variables

Create a `.env.local` file in the project root:
```env
PORT=3000
HOST_NAME=localhost
NEXT_PUBLIC_SFU_URL=http://localhost:3000
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

#### 4. Check Browser Console

Open browser DevTools (F12) and check the Console tab for detailed error messages:
- Look for connection errors
- Check if the SFU URL is correct
- Verify WebSocket connection attempts

#### 5. Verify Dependencies

Make sure all dependencies are installed:
```bash
npm install
```

Required packages:
- `mediasoup`
- `mediasoup-client`
- `socket.io`
- `socket.io-client`
- `tsx` (for running the server)

#### 6. Check Firewall/Antivirus

Sometimes firewalls or antivirus software can block WebSocket connections. Try:
- Temporarily disabling firewall/antivirus
- Adding exceptions for Node.js and your browser

#### 7. Network Issues

If running on a different machine or in a container:
- Update `NEXT_PUBLIC_SFU_URL` to the correct IP address
- Ensure port 3000 is accessible
- Check network connectivity

#### 8. FFmpeg Not Installed

Server-side recording requires FFmpeg to be installed on the server:

```bash
# Check if FFmpeg is installed
ffmpeg -version

# Install FFmpeg:
# Windows: Download from https://ffmpeg.org/download.html or use chocolatey: choco install ffmpeg
# Mac: brew install ffmpeg
# Linux: sudo apt-get install ffmpeg (Ubuntu/Debian) or sudo yum install ffmpeg (RHEL/CentOS)
```

### Debug Steps

1. **Check if server is listening:**
   ```bash
   # Windows
   netstat -ano | findstr :3000
   
   # Mac/Linux
   lsof -i :3000
   ```

2. **Test WebSocket connection manually:**
   Open browser console and run:
   ```javascript
   const socket = io('http://localhost:3000');
   socket.on('connect', () => console.log('Connected!'));
   socket.on('connect_error', (err) => console.error('Error:', err));
   ```

3. **Check server logs:**
   Look for errors in the terminal where the SFU server is running

### Error Messages Explained

- **"ECONNREFUSED"**: Server is not running or not accessible
- **"Timeout"**: Server is not responding within 10 seconds
- **"CORS error"**: Server CORS configuration issue
- **"Transport failed"**: WebRTC transport setup issue

## Common Error: "Cannot read properties of undefined (reading 'getUserMedia')"

### Root Cause

This error occurs during server-side rendering (SSR) in Next.js when the code tries to access browser APIs like `navigator.mediaDevices` on the server.

### Solution

The code should only access browser APIs on the client side. If you see this error:
1. Ensure the component is marked with `"use client"` directive
2. Check that `navigator.mediaDevices` is accessed only in `useEffect` hooks or event handlers
3. Verify the browser supports the MediaDevices API

## Common Error: Camera/Microphone Permission Denied

### Root Cause

The browser requires explicit user permission to access camera and microphone.

### Solution

1. **Check browser permissions:**
   - Look for a permission popup in the browser's address bar
   - Click "Allow" when prompted

2. **Manually grant permissions:**
   - **Chrome/Edge:** Click the lock icon → Site settings → Allow camera/microphone
   - **Firefox:** Click the shield icon → Permissions → Allow camera/microphone
   - **Safari:** Safari → Settings → Websites → Camera/Microphone → Allow

3. **Check system permissions:**
   - Ensure your operating system allows the browser to access camera/microphone
   - On macOS: System Preferences → Security & Privacy → Camera/Microphone
   - On Windows: Settings → Privacy → Camera/Microphone

## Common Error: FFmpeg Recording Issues

### Root Causes

1. **FFmpeg not installed** - The server needs FFmpeg to record videos
2. **FFmpeg process hanging** - Recording doesn't stop when client disconnects
3. **Empty video files** - Recording starts but produces 0-byte files

### Solutions

1. **Install FFmpeg** (see section 8 above)

2. **Check recording logs:**
   - Look for FFmpeg errors in the server console
   - Verify that the recording process starts when you click "Start Recording"

3. **Verify file output:**
   - Check the `uploads/{sessionId}/` directory
   - Files should be named: `{username} - {useremail} - {timestamp}.mkv`
   - If files are 0 bytes, check FFmpeg logs for errors

4. **Check permissions:**
   - Ensure the server has write permissions to the `uploads/` directory

## Still Having Issues?

1. Check that the server is running (`npm run dev`)
2. Verify port 3000 is not blocked
3. Check browser console for detailed errors
4. Ensure all dependencies are installed (`npm install`)
5. Verify FFmpeg is installed and accessible
6. Check server logs for detailed error messages
7. Try restarting the server
8. Clear browser cache and reload the page
