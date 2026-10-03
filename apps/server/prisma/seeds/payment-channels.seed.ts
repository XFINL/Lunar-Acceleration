import type { Prisma, PrismaClient } from '@prisma/client'

interface PaymentChannelItem {
  channel: string
  name: string
  config: Record<string, unknown>
  status: number
}

/** 支付渠道占位（默认全部禁用，待接入真实商户配置） */
const PAYMENT_CHANNELS: PaymentChannelItem[] = [
  {
    channel: 'wechat',
    name: '微信支付',
    config: { mchId: '', apiV3Key: '', certSerialNo: '' },
    status: 0,
  },
  {
    channel: 'alipay',
    name: '支付宝',
    config: { appId: '', privateKey: '', publicKey: '' },
    status: 0,
  },
  {
    channel: 'stripe',
    name: 'Stripe',
    config: { publishableKey: '', secretKey: '', webhookSecret: '' },
    status: 0,
  },
]

export async function seedPaymentChannels(prisma: PrismaClient): Promise<number> {
  for (const item of PAYMENT_CHANNELS) {
    await prisma.paymentChannel.upsert({
      where: { channel: item.channel },
      update: { name: item.name },
      create: {
        channel: item.channel,
        name: item.name,
        config: item.config as Prisma.InputJsonValue,
        status: item.status,
      },
    })
  }
  return PAYMENT_CHANNELS.length
}
