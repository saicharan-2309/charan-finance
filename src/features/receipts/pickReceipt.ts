import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { ActionSheetIOS, Alert, Linking, Platform } from 'react-native';

import type { LocalFile } from '@/services/attachments';

type Source = 'camera' | 'library' | 'files';

function askSource(): Promise<Source | null> {
  return new Promise((resolve) => {
    const options = ['Take photo', 'Choose from library', 'Choose PDF from Files', 'Cancel'];
    const map: (Source | null)[] = ['camera', 'library', 'files', null];
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options, cancelButtonIndex: 3, title: 'Attach receipt' },
        (i) => resolve(map[i] ?? null),
      );
    } else {
      Alert.alert('Attach receipt', undefined, [
        { text: options[0], onPress: () => resolve('camera') },
        { text: options[1], onPress: () => resolve('library') },
        { text: options[2], onPress: () => resolve('files') },
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
      ]);
    }
  });
}

function permissionDenied(what: string) {
  Alert.alert(
    `${what} access is off`,
    `Allow ${what.toLowerCase()} access for BUD in Settings to attach receipts.`,
    [
      { text: 'Not now', style: 'cancel' },
      { text: 'Open Settings', onPress: () => void Linking.openSettings() },
    ],
  );
}

/** Lets the user capture or choose a receipt. Returns null if cancelled. */
export async function pickReceipt(forceSource?: Source): Promise<LocalFile | null> {
  const source = forceSource ?? (await askSource());
  if (!source) return null;

  if (source === 'files') {
    const res = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'image/*'],
      copyToCacheDirectory: true,
    });
    if (res.canceled || !res.assets?.[0]) return null;
    const a = res.assets[0];
    return { uri: a.uri, mimeType: a.mimeType ?? 'application/pdf' };
  }

  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      permissionDenied('Camera');
      return null;
    }
    const res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8, exif: false });
    if (res.canceled || !res.assets?.[0]) return null;
    return { uri: res.assets[0].uri, mimeType: res.assets[0].mimeType ?? 'image/jpeg' };
  }

  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted && perm.accessPrivileges !== 'limited') {
    permissionDenied('Photo library');
    return null;
  }
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 0.8,
    exif: false,
  });
  if (res.canceled || !res.assets?.[0]) return null;
  return { uri: res.assets[0].uri, mimeType: res.assets[0].mimeType ?? 'image/jpeg' };
}
