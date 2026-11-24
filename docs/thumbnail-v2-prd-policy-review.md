# Thumbnail v2 PRD policy review (synthetic, non-applied)

This document describes a future least-privilege permission review. It contains no real bucket names, exact policy JSON, policy attachment or Wasabi policy change.

## Intended identities

- **Backfill identity:** dedicated `THUMBNAIL_PRD_BACKFILL_*` credentials. It may list approved source buckets and read source objects. It may read derived metadata and create objects only in the fixed private `v2/*` namespace of the fixed derived bucket.
- **Preflight identity:** independent `THUMBNAIL_PRD_PREFLIGHT_*` read-only credentials. It may call `ListObjectsV2` only for the approved job source and prefix/root. It has no object-body or write permission.

## Permission review

For each future approved source bucket:

- `s3:ListBucket` for listing the exact bucket scope.
- `s3:GetObject` for source object reads.

For the fixed derived bucket:

- `s3:GetObject` for `HeadObject` checks, including missing-object classification.
- `s3:PutObject` only for `v2/*`.
- No `s3:DeleteObject`, source write/delete, public access or account-wide grant.

A Wasabi account policy can also grant broad resource access even if the task JSON is narrow. The owner must provide a sanitized union of effective existing user, group and bucket policies before a real policy can be prepared. `HeadObject` uses `s3:GetObject`; it does not use a distinct `s3:HeadObject` action.

The Wasabi implementation must verify whether `HeadObject` absence is distinguishable from denial. A provider `403` must not be interpreted as a missing derived object. `ListObjectsV2` also does not prove write permission.

The backfill sends `IfNoneMatch: "*"` on derived `PutObject`, but that request header is not an IAM (Identity and Access Management) or bucket-policy create-only guarantee. Permission alone does not enforce server-side create-only semantics. Denials and ambiguous writes fail closed and remain conservative on retry.
