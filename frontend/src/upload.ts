import * as ImagePicker from "expo-image-picker";
import { Platform } from "react-native";
import { api } from "./api";

async function ensurePerm() {
  const cur = await ImagePicker.getMediaLibraryPermissionsAsync();
  if (cur.status === "granted") return true;
  if (cur.canAskAgain !== false) {
    const req = await ImagePicker.requestMediaLibraryPermissionsAsync();
    return req.status === "granted";
  }
  return false;
}

async function ensureCameraPerm() {
  const cur = await ImagePicker.getCameraPermissionsAsync();
  if (cur.status === "granted") return true;
  if (cur.canAskAgain !== false) {
    const req = await ImagePicker.requestCameraPermissionsAsync();
    return req.status === "granted";
  }
  return false;
}

export async function pickAndUpload(source: "library" | "camera" = "library"): Promise<string | null> {
  const ok = source === "camera" ? await ensureCameraPerm() : await ensurePerm();
  if (!ok) return null;
  const opts: ImagePicker.ImagePickerOptions = {
    mediaTypes: ["images"],
    quality: 0.6,
    allowsEditing: false,
  };
  const res = source === "camera"
    ? await ImagePicker.launchCameraAsync(opts)
    : await ImagePicker.launchImageLibraryAsync(opts);
  if (res.canceled || !res.assets?.[0]) return null;
  const asset = res.assets[0];
  const form = new FormData();
  const name = asset.fileName || `img_${Date.now()}.jpg`;
  const type = asset.mimeType || "image/jpeg";
  if (Platform.OS === "web") {
    const blob = await (await fetch(asset.uri)).blob();
    form.append("file", blob, name);
  } else {
    // @ts-ignore native FormData shape
    form.append("file", { uri: asset.uri, name, type });
  }
  const r = await api<{ path: string; url: string }>("/upload", { method: "POST", body: form as any, headers: {} });
  // On native, browser's FormData sets Content-Type; must not force JSON
  return r.path;
}
