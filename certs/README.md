# Extra trust anchor for the Cambodian open-data portal

`data.mef.gov.kh` sits behind Cloudflare and serves this chain:

```
CN=mef.gov.kh
  └── CN=Cloudflare TLS Issuing ECC CA 1
        └── CN=SSL.com TLS Transit ECC CA R2
              └── CN=AAA Certificate Services   (Comodo CA Limited, 2004)
```

The chain terminates at **AAA Certificate Services**, a legacy root that macOS
and Windows still trust but which Node.js no longer ships in its bundled
Mozilla CA list. Node therefore cannot build a path to a trusted root and every
request fails with `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`, even though `curl` on
the same machine succeeds.

`mef-open-data-ca.pem` holds that root so RielVest can verify the portal's
certificate normally. It is used **only** for requests to the open-data portal,
via a dedicated dispatcher in `src/ingest/mefClient.ts` — certificate
verification stays fully enabled, both for this host and for every other
connection the process makes.

To refresh it, take the root from a trust store that has it, for example:

```bash
security find-certificate -a -c "AAA Certificate Services" -p \
  /System/Library/Keychains/SystemRootCertificates.keychain
```
