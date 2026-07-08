// Thin wrapper around expo-speech for ride voice prompts. Isolated so the
// hook logic stays testable (tests mock this module) and so all Dutch TTS
// configuration lives in one place.
import * as Speech from "expo-speech";

/**
 * Speak one prompt in Dutch. A new prompt interrupts the previous one — for
 * navigation, the latest instruction is always the relevant one. On iOS the
 * system routes TTS through the playback audio session, so prompts behave
 * like navigation apps do with respect to the silent switch.
 */
export function speakPrompt(text: string): void {
  try {
    Speech.stop();
    Speech.speak(text, { language: "nl-NL" });
  } catch {
    // Speech is best-effort: never let TTS failures break ride tracking.
  }
}

/** Stop any prompt that is currently being spoken. */
export function stopSpeaking(): void {
  try {
    Speech.stop();
  } catch {
    // Ignore.
  }
}
