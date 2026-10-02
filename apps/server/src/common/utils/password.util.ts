import * as bcrypt from 'bcryptjs'

const BCRYPT_ROUNDS = 12
const PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[\S]{8,32}$/

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS)
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash)
}

/** 密码强度：8-32 位，含大小写字母与数字（见 05-backend.md §12.1） */
export function isStrongPassword(plain: string): boolean {
  return PASSWORD_PATTERN.test(plain)
}
