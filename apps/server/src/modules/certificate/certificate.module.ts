import { Module } from '@nestjs/common'
import { CertificateController } from './certificate.controller'
import { CertificateService } from './certificate.service'
import { AcmeService } from './acme.service'
import { AcmeRenewalWorker } from './acme-renewal.worker'

@Module({
  controllers: [CertificateController],
  providers: [CertificateService, AcmeService, AcmeRenewalWorker],
  exports: [CertificateService, AcmeService],
})
export class CertificateModule {}
