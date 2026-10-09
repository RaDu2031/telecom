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

export function generateRandomPassword(length = 10): string {
  const letters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const digits = '0123456789';
  const symbols = '!@#$%&*';

  let pwd = '';
  // Ensure at least 1 uppercase, 1 lowercase, 1 digit, 1 symbol
  pwd += letters[Math.floor(Math.random() * 26)]; // lowercase
  pwd += letters[26 + Math.floor(Math.random() * 26)]; // uppercase
  pwd += digits[Math.floor(Math.random() * 10)];
  pwd += symbols[Math.floor(Math.random() * symbols.length)];

  const allChars = letters + digits + symbols;
  for (let i = 4; i < length; i++) {
    pwd += allChars[Math.floor(Math.random() * allChars.length)];
  }

  // Shuffle
  return pwd
    .split('')
    .sort(() => Math.random() - 0.5)
    .join('');
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
