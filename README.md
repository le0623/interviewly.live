# Interviewly - Asynchronous Video Interview Platform

A web application for conducting asynchronous video interviews where candidates record a single continuous video while answering multiple questions sequentially.

## Features

- **Landing Page**: Simple explanation of the async interview process
- **Session Management**: Dynamic routing for interview sessions (`/session/{sessionId}`)
- **Candidate Information**: Mandatory modal for collecting candidate name and email
- **Interview Interface**: 
  - Sequential question display
  - Single continuous video recording
  - Real-time video upload using MediaRecorder API
  - Camera and microphone device selection
  - Audio waveform visualization
  - Total duration timer and per-question timers
- **Backend Storage**: Organized file structure for interview data and videos

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

2. Run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

3. Open [http://localhost:3000](http://localhost:3000) in your browser

## Usage

### Starting an Interview

1. Navigate to the landing page at `/`
2. Click "Start Interview" or navigate directly to `/session/{sessionId}` (e.g., `/session/demo`)
3. Fill in the mandatory candidate information modal (name and email)
4. Review the interview description and questions
5. Select your camera and microphone devices
6. Click "Start Recording" when ready
7. Answer questions sequentially by clicking "Next" to move between questions
8. The video is uploaded in real-time as you record
9. Click "Stop Recording" when finished

### File Structure

The application stores interview data in the following structure:

```
/uploads
  /{sessionId}
    - interview.json          # Interview configuration
    - {username}-{userEmail}.webm  # Candidate video recording
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

### POST `/api/upload`

Receives video chunks in real-time and saves them to disk. The final video file is saved as `{username}-{userEmail}.webm` in the session directory.

**Form Data:**
- `sessionId`: Session identifier
- `name`: Candidate name (sanitized for filename)
- `email`: Candidate email (sanitized for filename)
- `chunk`: Video blob chunk (optional, for chunk uploads)
- `isFinal`: "true" or "false" (indicates final upload)

## Technical Details

### Recording Technology

- Uses MediaRecorder API with WebM format (VP8 video, Opus audio)
- Chunks are uploaded every second during recording
- Real-time streaming ensures data is saved even if connection is interrupted

### Browser Requirements

- Modern browser with WebRTC support
- Camera and microphone permissions
- Recommended: Chrome, Firefox, Edge, or Safari (latest versions)

## Project Structure

```
interviewly/
├── app/
│   ├── api/
│   │   ├── interview/[sessionId]/route.ts  # Interview config API
│   │   └── upload/route.ts                 # Video upload API
│   ├── session/[sessionId]/page.tsx        # Session page
│   ├── layout.tsx                          # Root layout
│   └── page.tsx                            # Landing page
├── components/
│   ├── AudioWaveform.tsx                   # Audio level visualization
│   ├── CandidateInfoModal.tsx              # Mandatory info modal
│   ├── InterviewInterface.tsx             # Main interview UI
│   └── MediaControls.tsx                   # Device selection
└── uploads/                                # Generated at runtime
    └── {sessionId}/
        ├── interview.json
        └── {username}-{userEmail}.webm
```

## Development

### Building for Production

```bash
npm run build
npm start
```

### Linting

```bash
npm run lint
```

## Notes

- Device selection is disabled during recording to prevent interruptions
- The candidate information modal cannot be dismissed and must be completed
- Video files are stored in `.webm` format
- Filenames are sanitized to ensure safe file system storage
- The application supports multiple concurrent interview sessions

## License

This project is private and proprietary.
