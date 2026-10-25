# VoxClean — Product Requirements Document

## 1. Overview

VoxClean is a local AI-powered application that converts spoken audio into clean, readable text by removing filler words, reducing repetition, and summarizing key points.

All audio processing and text generation happen locally on the user's computer using Whisper and Ollama.

## 2. Goals

- Convert speech into text.
- Remove filler words such as "um," "uh," and unnecessary repetitions.
- Generate concise summaries of spoken content.
- Keep user data private through local processing.
- Remain free to use without paid APIs.

## 3. Core Features

### 3.1 Audio Input

- Record audio through the microphone.
- Upload an existing audio file.
- Display recording duration.

### 3.2 Transcription

- Convert audio into text using a local speech recognition model.
- Display the original transcript before processing.

### 3.3 Text Processing

Provide two processing modes:

- **Clean Transcript:** Remove filler words, correct punctuation, and improve readability without changing the meaning.
- **Summarize:** Condense the transcript into its main points.

### 3.4 Results

- Display the processed text.
- Allow users to edit the result.
- Copy the result to the clipboard.
- Display the original transcript when requested.

### 3.5 Local Processing

- Use Whisper for speech recognition.
- Use Ollama for text processing.
- Do not require user accounts or cloud AI APIs.
- Store no recordings or transcripts permanently by default.

## 4. User Flow

1. Open VoxClean.
2. Record audio or upload a file.
3. Click Transcribe.
4. Review the original transcript.
5. Select Clean Transcript or Summarize.
6. Review and edit the result.
7. Copy the final text.

## 5. Technology Stack

- **Desktop framework:** Tauri
- **Frontend:** React + TypeScript
- **Speech recognition:** Whisper.cpp
- **Language model:** Ollama
- **Styling:** Tailwind CSS

## 6. Non-Functional Requirements

- Audio and text processing must remain local.
- The interface must be minimal and responsive.
- Processing errors must be communicated clearly.
- The application must not silently change the speaker's intended meaning.
- The application must work without an internet connection after setup and model downloads.

## 7. Out of Scope

The initial version will not include:

- User accounts or cloud synchronization.
- Paid features or subscriptions.
- Meeting integrations.
- Real-time transcription.
- Multiple speakers or speaker identification.
- Mobile applications.
- Automatic cloud backups.

## 8. Success Criteria

The MVP is successful when a user can:

- Record or upload audio.
- Generate a transcript locally.
- Clean up the transcript or summarize it.
- Copy or edit the result.
- Complete the workflow without sending audio or text to external AI services.
