-- 0000_extensions (ADR-0013): citext, init_core'dan ÖNCE uygulanır.
-- PostgreSQL 14+: contrib paketi gerektirir (deploy.sh ön adımı da aynı komutu çalıştırır [B37]).
CREATE EXTENSION IF NOT EXISTS citext;
