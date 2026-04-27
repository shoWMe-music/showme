import { FirebaseError } from "firebase/app";

export function getFirestoreErrorMessage(error: unknown): string {
  if (error instanceof FirebaseError) {
    switch (error.code) {
      case "permission-denied":
        return "Firestore blocked this action. Sign in and check your security rules.";
      case "unavailable":
        return "Firestore is temporarily unavailable. Try again in a moment.";
      case "failed-precondition":
        return "This operation cannot run right now. Refresh and try again.";
      default:
        return error.message;
    }
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Something went wrong saving to the database.";
}
