# SSN Encryption — Operational Runbook (T-1.1.0)

Closes GA-001 (regulatory / Critical). Pairs with the application code in
`src/services/cryptoService.js` and `src/services/kms/`.

This runbook covers **provisioning, rotation, and the Deploy 1a/1b/1c
rollout** of AES-256-GCM field-level encryption for `User.driver.ssn`.

---

## 1. Threat model

- **At rest:** ciphertext only. Database backups, BSON exports, replica logs
  all contain `enc:v1:...` envelopes, never plaintext.
- **In flight (server → DB):** TLS plus ciphertext payload.
- **In flight (client → server):** TLS only. SSN is plaintext on the wire and
  in memory during the signup handler. Acceptable because the client is the
  source.
- **In flight (signup token):** also ciphertext. The `docsToken` JWT carries
  the SSN as the same `enc:v1:...` envelope so a stolen token does not
  reveal the SSN (see `authService.js` `driverSignupDocuments`).
- **At decrypt time:** the unwrapped DEK lives in process memory only. Heap
  dumps from the app contain it; database / network captures do not.

---

## 2. Cloud + key choice

- **Provider:** AWS KMS (the codebase already depends on `@aws-sdk/client-s3`;
  staying on AWS avoids a new cloud vendor).
- **Key type:** customer-managed symmetric KMS key, usage `ENCRYPT_DECRYPT`.
- **Key spec:** `SYMMETRIC_DEFAULT` (AES-256-GCM under the hood).
- **Alias:** one per environment — `alias/aleet-ssn-prod`, `alias/aleet-ssn-staging`,
  `alias/aleet-ssn-dev`. Aliases let us rotate the underlying key without
  changing application config.
- **Auto-rotation:** **off** (default). We rotate manually so the rotation is
  auditable and tied to a deploy. Annual rotation cadence (see §5).
- **Multi-region:** off for MVP. Re-evaluate if we deploy to a second region.

---

## 3. IAM

Only the backend service role may call `Decrypt`. No human, no other
service. The full policy on the KMS key:

```json
{
  "Statement": [
    {
      "Sid": "RootAccount",
      "Effect": "Allow",
      "Principal": { "AWS": "arn:aws:iam::<ACCOUNT>:root" },
      "Action": "kms:*",
      "Resource": "*"
    },
    {
      "Sid": "BackendDecryptOnly",
      "Effect": "Allow",
      "Principal": { "AWS": "arn:aws:iam::<ACCOUNT>:role/aleet-backend-prod" },
      "Action": ["kms:Decrypt", "kms:DescribeKey"],
      "Resource": "*"
    },
    {
      "Sid": "KeyAdminEncryptForRotation",
      "Effect": "Allow",
      "Principal": { "AWS": "arn:aws:iam::<ACCOUNT>:role/aleet-keyadmin" },
      "Action": ["kms:Encrypt", "kms:Decrypt", "kms:DescribeKey", "kms:GenerateDataKey"],
      "Resource": "*"
    }
  ]
}
```

- `aleet-backend-prod` is the IAM role the ECS/EC2/EKS task assumes. It can
  **decrypt** the wrapped DEK and nothing else.
- `aleet-keyadmin` is a break-glass role used **only** during rotation. Not
  attached to any user; assume-role audit logs every use.
- Direct human KMS access (developers, on-call) is **not** granted.

---

## 4. Provisioning (one-time per environment)

### 4.1 Create the KMS key

```bash
aws kms create-key \
  --description "Aleet SSN field-level encryption (prod)" \
  --key-usage ENCRYPT_DECRYPT \
  --customer-master-key-spec SYMMETRIC_DEFAULT \
  --policy file://kms-policy.json

# Note the KeyId from the response, then create an alias:
aws kms create-alias \
  --alias-name alias/aleet-ssn-prod \
  --target-key-id <KeyId>
```

### 4.2 Generate the wrapped Data Encryption Key (DEK)

The application uses a 32-byte DEK for AES-256-GCM. KMS holds the master key
(KEK) that wraps it.

```bash
# Generate a random 32-byte DEK and wrap it with the KMS key in one call.
WRAPPED=$(aws kms generate-data-key \
  --key-id alias/aleet-ssn-prod \
  --key-spec AES_256 \
  --query CiphertextBlob \
  --output text)

echo "SSN_DEK_CIPHERTEXT (base64): $WRAPPED"
```

### 4.3 Store the wrapped DEK in the secrets manager

Do **not** put it in a `.env` file. Put it in AWS Secrets Manager (or your
chosen secret store) and inject it into the task definition at deploy time.

```bash
aws secretsmanager create-secret \
  --name aleet/prod/ssn-dek \
  --secret-string "{\"SSN_DEK_CIPHERTEXT\":\"$WRAPPED\"}"
```

### 4.4 Configure the application

The backend reads these env vars at boot:

| Var | Required when | Description |
|---|---|---|
| `KMS_PROVIDER` | always (prod) | Set to `aws` to enable KMS. Unset/`env` falls back to legacy `SSN_ENCRYPTION_KEY`. |
| `KMS_KEY_ID` | KMS_PROVIDER=aws | KMS alias or full ARN (e.g. `alias/aleet-ssn-prod`). |
| `SSN_DEK_CIPHERTEXT` | KMS_PROVIDER=aws | base64 of the KMS-wrapped DEK from step 4.2. |
| `AWS_REGION` | KMS_PROVIDER=aws | AWS region of the KMS key. |
| `SSN_ENCRYPTION_KEY` | dev / legacy | 32 bytes base64. Bypassed when KMS_PROVIDER=aws. |

The app calls `KMSClient.Decrypt({ CiphertextBlob, KeyId })` once at boot,
hands the unwrapped 32-byte DEK to `cryptoService.initializeKeyFromKms()`,
and never calls KMS again. Decrypt cost is one API call per process start.

### 4.5 Dev / staging story

Each environment has its own KMS alias and its own wrapped DEK. **Do not
share keys across environments.** A dev key compromise must never expose prod
data.

For local development, set `KMS_PROVIDER=env` (or leave unset) and use a
local `SSN_ENCRYPTION_KEY` value — never the prod DEK or anything decryptable
from it.

---

## 5. Rotation policy

**Cadence:** annual. Tied to a calendar reminder + a deploy window.

**Procedure (no downtime, ≤ 1 hour):**

1. Generate a new wrapped DEK on the same KMS key (step 4.2).
2. Run the rotation script (to be written; tracked in the follow-up backlog):
   - Read every row's ciphertext with the OLD key.
   - Re-encrypt with the NEW key, change the envelope prefix from `enc:v1:`
     to `enc:v2:`.
   - Update `SSN_DEK_CIPHERTEXT` in secrets manager to the new wrapped DEK.
3. Deploy. The app reads `SSN_DEK_CIPHERTEXT`, unwraps the new DEK, starts
   accepting reads of both `v1` (during the rollout window) and `v2`.
4. After backfill confirms 100% v2, deploy a code change removing the v1
   decrypt path.

Rotation is **not** a credentials-leak response. For that, see §7.

---

## 6. Deploy 1a / 1b / 1c rollout (matches `T-1.1.1` in the plan)

- **Deploy 1a:** new writes encrypt. Reads accept both ciphertext and legacy
  plaintext via the dual-read fallback in `cryptoService.decrypt`. Old rows
  unaffected.
- **Deploy 1b:** run `node src/scripts/ssnBackfill.js` against production.
  Re-encrypts every plaintext row in place. Failures write an `AuditLog`
  entry with `category=system, action=ssn.backfill.failed` for ops review.
  **Gate to 1c:** that failure queue must be empty.
- **Deploy 1c:** set `STRICT_DECRYPT_ONLY=true` in env. `cryptoService.decrypt`
  now throws on any plaintext value — meaning the backfill must be 100%
  complete. This makes the no-plaintext invariant enforceable at the code
  level.

---

## 7. Incident response — DEK or KEK compromise

- **Wrapped DEK leaked** (e.g. secrets manager misconfiguration):
  - Rotate the DEK immediately (§5).
  - The leaked wrapped value is useless without the KEK (which never left KMS).
- **Backend role compromised** (the role that can call Decrypt):
  - Revoke the role. Issue a new role with the same IAM policy.
  - Rotate the DEK because the unwrapped DEK may have been read from the
    compromised host's memory.
- **KMS key itself compromised** (assume the master key escaped AWS):
  - Cycle the customer master key (`aws kms schedule-key-deletion`,
    create a new key, point the alias at it).
  - Re-wrap a new DEK with the new master key.
  - Run the rotation script (§5).
  - Disclose to legal / compliance per the FCRA breach-notice timeline.

---

## 8. Verification checklist

Before declaring T-1.1.0 done in an environment:

- [ ] KMS key created with the alias above.
- [ ] Key policy attached (matches §3 verbatim).
- [ ] DEK generated + wrapped (§4.2).
- [ ] Wrapped DEK stored in secrets manager (`aleet/<env>/ssn-dek`).
- [ ] Task definition / deployment config sets `KMS_PROVIDER=aws`,
      `KMS_KEY_ID`, `SSN_DEK_CIPHERTEXT`, `AWS_REGION`.
- [ ] Backend boots successfully and emits log line `AWS KMS unwrapped the SSN DEK`.
- [ ] A test signup writes a new SSN — verify the DB row contains
      `enc:v1:` prefix, not plaintext.
- [ ] Deploy 1b backfill has run and the admin queue is empty.
- [ ] `STRICT_DECRYPT_ONLY=true` flipped for Deploy 1c (only after 1b is clean).
- [ ] Annual rotation reminder added to the on-call calendar.
