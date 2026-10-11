/**
 * Utility functions for Authentication, Password Hashing, CPF Validation,
 * Name Normalization, and Security Audit Helpers.
 */

export function normalizeNameForMatching(rawName: string): string {
  if (!rawName) return '';
  // 1. Remove text inside parentheses e.g. "Rafael de Souza Caldeira (Alex Magalhães)" -> "Rafael de Souza Caldeira"
  let text = rawName.replace(/\([^)]*\)/g, '');
  // 2. Normalize accents and convert to lowercase
  text = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  // 3. Remove non-alphanumeric characters, collapse whitespace
  text = text.replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
  return text;
}

export function validateCpfFormat(rawCpf: string): {
  isValid: boolean;
  cleanCpf: string;
  first3Digits: string;
} {
  if (!rawCpf) {
    return { isValid: false, cleanCpf: '', first3Digits: '' };
  }
  const digits = rawCpf.replace(/\D/g, '');
  if (digits.length !== 11) {
    return { isValid: false, cleanCpf: digits, first3Digits: digits.slice(0, 3) };
  }
  // Basic check for repeated digits e.g. "00000000000"
  if (/^(\d)\1{10}$/.test(digits)) {
    return { isValid: false, cleanCpf: digits, first3Digits: digits.slice(0, 3) };
  }
  return {
    isValid: true,
    cleanCpf: digits,
    first3Digits: digits.slice(0, 3),
  };
}

function getSecureRandomInt(max: number): number {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const arr = new Uint32Array(1);
    crypto.getRandomValues(arr);
    return arr[0] % max;
  }
  return Math.floor(Math.random() * max);
}

export function generateRandomPassword(length = 10): string {
  const lowercase = 'abcdefghijklmnopqrstuvwxyz';
  const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const digits = '0123456789';
  const symbols = '!@#$%&*';

  // Ensure at least 1 lowercase, 1 uppercase, 1 digit, 1 symbol
  const chars: string[] = [
    lowercase[getSecureRandomInt(lowercase.length)],
    uppercase[getSecureRandomInt(uppercase.length)],
    digits[getSecureRandomInt(digits.length)],
    symbols[getSecureRandomInt(symbols.length)],
  ];

  const allChars = lowercase + uppercase + digits + symbols;
  for (let i = chars.length; i < length; i++) {
    chars.push(allChars[getSecureRandomInt(allChars.length)]);
  }

  // Fisher-Yates cryptographically secure shuffle
  for (let i = chars.length - 1; i > 0; i--) {
    const j = getSecureRandomInt(i + 1);
    const temp = chars[i];
    chars[i] = chars[j];
    chars[j] = temp;
  }

  return chars.join('');
}

export function validatePasswordComplexity(password: string): {
  isValid: boolean;
  message?: string;
} {
  if (!password || password.length < 8) {
    return {
      isValid: false,
      message: 'A senha deve conter no mínimo 8 caracteres.',
    };
  }

  const hasLetter = /[a-zA-Z]/.test(password);
  const hasDigit = /[0-9]/.test(password);

  if (!hasLetter || !hasDigit) {
    return {
      isValid: false,
      message: 'A nova senha deve conter letras e números.',
    };
  }

  return { isValid: true };
}

export function generateRandomSalt(byteLength = 16): string {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const arr = new Uint8Array(byteLength);
    crypto.getRandomValues(arr);
    return Array.from(arr)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export async function hashStringWithSalt(plainText: string, salt: string): Promise<string> {
  if (!plainText) return '';
  const saltedPayload = `${salt}:${plainText}`;

  if (typeof crypto !== 'undefined' && crypto.subtle) {
    try {
      const msgUint8 = new TextEncoder().encode(saltedPayload);
      const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch {
      // Fallback below
    }
  }

  let hash = 0;
  for (let i = 0; i < saltedPayload.length; i++) {
    const char = saltedPayload.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return 's_' + Math.abs(hash).toString(36);
}

export async function createSaltedHash(plainText: string): Promise<{ hash: string; salt: string }> {
  const salt = generateRandomSalt(16);
  const hash = await hashStringWithSalt(plainText, salt);
  return { hash, salt };
}

export async function verifySaltedHash(
  plainText: string,
  salt: string,
  expectedHash: string
): Promise<boolean> {
  const computed = await hashStringWithSalt(plainText, salt);
  return computed === expectedHash;
}

export async function hashString(plainText: string): Promise<string> {
  if (!plainText) return '';
  if (typeof window !== 'undefined' && window.crypto && window.crypto.subtle) {
    try {
      const msgUint8 = new TextEncoder().encode(plainText);
      const hashBuffer = await window.crypto.subtle.digest('SHA-256', msgUint8);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch {
      // Fallback below
    }
  }
  // Simple fallback hash
  let hash = 0;
  for (let i = 0; i < plainText.length; i++) {
    const char = plainText.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return 'h_' + Math.abs(hash).toString(36);
}
