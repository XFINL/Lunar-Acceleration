import { Injectable } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import { dirname, extname, join, resolve } from 'node:path'

export interface UploadedFileLike {
  buffer: Buffer
  originalname: string
  mimetype: string
  size: number
}

export interface StoredFile {
  /** 相对存储路径，如 site/2026/10/xxx.png */
  path: string
  /** 对外访问地址，如 /uploads/site/2026/10/xxx.png */
  url: string
  size: number
}

const TYPE_PATTERN = /^[a-z0-9_-]{1,32}$/

/** 本地磁盘存储驱动（见 05-backend.md §14.1，路径规则 §14.2） */
@Injectable()
export class LocalStorageService {
  private readonly root = resolve(process.cwd(), 'uploads')

  async save(file: UploadedFileLike, type = 'site'): Promise<StoredFile> {
    const safeType = TYPE_PATTERN.test(type) ? type : 'site'
    const ext = extname(file.originalname).toLowerCase() || '.bin'
    const now = new Date()
    const month = String(now.getMonth() + 1).padStart(2, '0')

    const relativePath = [safeType, String(now.getFullYear()), month, `${randomUUID()}${ext}`].join(
      '/',
    )
    const absolutePath = join(this.root, relativePath)

    await mkdir(dirname(absolutePath), { recursive: true })
    await writeFile(absolutePath, file.buffer)

    return { path: relativePath, url: this.getUrl(relativePath), size: file.size }
  }

  async remove(relativePath: string): Promise<void> {
    await unlink(join(this.root, relativePath))
  }

  getUrl(relativePath: string): string {
    return `/uploads/${relativePath}`
  }
}
