# Interviewly - Asynchronous Video Interview Platform

A web application for conducting asynchronous video interviews where candidates record a single continuous video while answering multiple questions sequentially.

## Features

- **Landing Page**: Simple explanation of the async interview process
- **Session Management**: Dynamic routing for interview sessions (`/session/{sessionId}`)
- **Candidate Information**: Mandatory modal for collecting candidate name and email
- **Interview Interface**: 
  - Sequential question display
  - Single continuous video recording
  - Real-time video streaming using WebRTC + SFU (Selective Forwarding Unit)
  - Low-latency, high-quality video transmission
  - Camera and microphone device selection
  - Audio waveform visualization
  - Total duration timer and per-question timers
- **Backend Storage**: Organized file structure for interview data and videos
- **WebRTC SFU Server**: Mediasoup-based SFU for efficient media routing

## Getting Started

### Prerequisites

- Node.js 18+ 
- npm, yarn, pnpm, or bun

### Installation

1. Install dependencies:

```bash
npm install
# or
yarn install
# or
pnpm install
```

2. Create a `.env.local` file (optional, defaults work for local development):
```env
PORT=3000
HOST_NAME=localhost
NEXT_PUBLIC_SFU_URL=http://localhost:3000
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

3. Start the development server (runs both Next.js app and SFU server in one process):

```bash
npm run dev
```

4. Open [http://localhost:3000](http://localhost:3000) in your browser

**Note:** The application uses a unified server that runs both the Next.js app and the WebRTC SFU server on the same port (3000 by default). This simplifies development and deployment.

## Usage

### Starting an Interview

1. Navigate to the landing page at `/`
2. Click "Start Interview" or navigate directly to `/session/{sessionId}` (e.g., `/session/demo`)
3. Fill in the mandatory candidate information modal (name and email)
4. Review the interview description and questions
5. Select your camera and microphone devices
6. Click "Start Recording" when ready
7. Answer questions sequentially by clicking "Next" to move between questions
8. The video is streamed in real-time via WebRTC to the SFU server
9. Click "Stop Recording" when finished

### File Structure

The application stores interview data in the following structure:

```
/uploads
  /{sessionId}
    - interview.json          # Interview configuration
    - {username} - {useremail} - {timestamp}.mkv  # Candidate video recording (Matroska format)
    - {username} - {useremail} - {timestamp}.sdp  # SDP file used for FFmpeg recording
```

## API Routes

### GET `/api/interview/[sessionId]`

Fetches the interview configuration for a given session. If no configuration exists, returns a default configuration and creates the interview.json file.

**Response:**
```json
{
  "description": "Interview description...",
  "questions": ["Question 1", "Question 2", ...],
  "totalDurationSeconds": 600
}
```

### POST `/api/recording/[sessionId]/finalize`

Finalizes the recording session after WebRTC streaming is complete.

**Body:**
```json
{
  "name": "Candidate Name",
  "email": "candidate@example.com"
}
```

## Technical Details

### Recording Technology

- Uses WebRTC for low-latency, high-quality video streaming
- Mediasoup SFU (Selective Forwarding Unit) for efficient media routing
- Server-side recording using FFmpeg for reliable video capture
- Real-time streaming with minimal latency (< 100ms typical)
- Supports VP8, VP9, and H.264 video codecs
- Opus audio codec for high-quality audio
- Matroska (MKV) container format for flexible video recording

### Browser Requirements

- Modern browser with WebRTC support
- Camera and microphone permissions
- Recommended: Chrome, Firefox, Edge, or Safari (latest versions)

## Project Structure

```
interviewly/
├── app/
│   ├── api/
│   │   ├── interview/[sessionId]/route.ts           # Interview config API
│   │   └── recording/[sessionId]/finalize/route.ts # Recording finalization
│   ├── session/[sessionId]/page.tsx                # Session page
│   ├── layout.tsx                                  # Root layout
│   └── page.tsx                                    # Landing page
├── components/
│   ├── AudioWaveform.tsx                           # Audio level visualization
│   ├── CandidateInfoModal.tsx                     # Mandatory info modal
│   ├── InterviewInterface.tsx                     # Main interview UI
│   └── MediaControls.tsx                          # Device selection
├── lib/
│   └── webrtc-client.ts                           # WebRTC client wrapper
├── server.ts                                       # Unified server (Next.js + SFU)
├── server/
│   ├── index.ts                                   # SFU server entry point (legacy)
│   ├── signaling/
│   │   └── server.ts                              # WebSocket signaling server
│   ├── sfu/
│   │   ├── router.ts                              # SFU router management
│   │   └── worker.ts                              # Mediasoup worker
│   └── recording/
│       └── recorder.ts                            # FFmpeg-based recording service
└── uploads/                                        # Generated at runtime
    └── {sessionId}/
        ├── interview.json
        ├── {username} - {useremail} - {timestamp}.mkv
        └── {username} - {useremail} - {timestamp}.sdp
```

## Development

### Building for Production

```bash
# Build the Next.js app
npm run build

# Start the production server (runs both Next.js and SFU)
npm start
```

**Note:** The production server runs both Next.js and the SFU server in a single process, just like development mode.

### Linting

```bash
npm run lint
```

## Notes

- Device selection is disabled during recording to prevent interruptions
- The candidate information modal cannot be dismissed and must be completed
- Video files are stored in `.mkv` (Matroska) format for reliable server-side recording
- Filenames follow the format: `{username} - {useremail} - {timestamp}.mkv`
- Filenames are sanitized to ensure safe file system storage
- The application supports multiple concurrent interview sessions
- The SFU server runs in the same process as the Next.js app (unified server)
- Recording automatically stops when the client disconnects
- FFmpeg must be installed on the server for recording to work
- For production deployment, configure `MEDIASOUP_ANNOUNCED_IP` with your server's public IP
- WebRTC requires HTTPS in production (or localhost for development)

## License

This project is private and proprietary.
