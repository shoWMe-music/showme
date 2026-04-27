import { FirebaseError } from "firebase/app";

export function getFirebaseAuthErrorMessage(error: unknown): string {
  if (error instanceof FirebaseError) {
    switch (error.code) {
      case "auth/invalid-email":
        return "The email address is not valid.";
      case "auth/user-disabled":
        return "This account has been disabled.";
      case "auth/user-not-found":
      case "auth/wrong-password":
      case "auth/invalid-credential":
        return "Incorrect email or password.";
      case "auth/email-already-in-use":
        return "That email is already in use.";
      case "auth/weak-password":
        return "Password is too weak. Use at least 6 characters.";
      case "auth/too-many-requests":
        return "Too many attempts. Please try again in a moment.";
      case "auth/network-request-failed":
        return "Network error. Please check your connection and try again.";
      default:
        return error.message;
    }
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Authentication failed. Please try again.";
}
