export interface Reservation {
  id: string;
  localPath: string;
  markerPath: string;
  fullPath: string;
}

export function typeDirPath(projectDir: string, type: string): string;
export function allocateId(
  projectDir: string,
  type: string,
  ext: string,
): Omit<Reservation, "fullPath">;
export function withReservedFileSync<T>(
  projectDir: string,
  type: string,
  ext: string,
  populate: (reservation: Reservation) => T,
): T;
