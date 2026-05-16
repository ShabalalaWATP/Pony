# Operator Guide

## Development

1. Copy `.env.example` to `.env` and replace secrets.
2. Run `make bootstrap`.
3. Run `make up` for Mongo, Redis, backend, and the placeholder frontend container.

## First admin

The first user may self-register. After that, registration requires an authenticated admin with a verified TOTP session.

## Authorized operator acknowledgement

Admin users must verify TOTP and submit the exact typed legal statement before active modules can be enabled in a later milestone.

Required statement:

`I am authorized to test the listed wireless targets in this engagement.`
