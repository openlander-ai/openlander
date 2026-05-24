export const MIN_PASSWORD_LENGTH = 8;

export function isPasswordTooShort(password: string): boolean {
  return password.trim().length < MIN_PASSWORD_LENGTH;
}
