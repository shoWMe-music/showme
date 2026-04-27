import { deleteObject, getDownloadURL, ref, uploadBytes } from "firebase/storage";

import { getFirebaseStorage } from "@/integrations/firebase";
import { getAuthClient } from "@/lib/firebaseAuth";

export async function uploadUserBinary(
  relativePath: string,
  data: Blob | Uint8Array | ArrayBuffer,
  contentType?: string,
): Promise<string> {
  const uid = getAuthClient().currentUser?.uid;
  if (!uid) throw new Error("You must be signed in to upload files.");
  const fullPath = `users/${uid}/${relativePath.replace(/^\//, "")}`;
  const storageRef = ref(getFirebaseStorage(), fullPath);
  await uploadBytes(storageRef, data, contentType ? { contentType } : undefined);
  return getDownloadURL(storageRef);
}

export async function deleteStorageFile(downloadUrl: string): Promise<void> {
  try {
    const storageRef = ref(getFirebaseStorage(), downloadUrl);
    await deleteObject(storageRef);
  } catch {
    // File may already be deleted or URL may be external — ignore
  }
}

export async function resolveStorageDownloadUrl(fileUrlOrPath: string): Promise<string> {
  if (fileUrlOrPath.startsWith("http") || fileUrlOrPath.startsWith("blob:")) {
    return fileUrlOrPath;
  }
  return getDownloadURL(ref(getFirebaseStorage(), fileUrlOrPath));
}
