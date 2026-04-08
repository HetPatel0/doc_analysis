import {
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const ownerTypeEnum = pgEnum("owner_type", ["guest", "user"]);
export const documentStatusEnum = pgEnum("document_status", [
  "queued",
  "indexing",
  "ready",
  "failed",
]);

export const usageSubjects = pgTable(
  "usage_subject",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerType: ownerTypeEnum("owner_type").notNull(),
    ownerId: text("owner_id").notNull(),
    fingerprintHash: text("fingerprint_hash"),
    uploadCount: integer("upload_count").notNull().default(0),
    chatCount: integer("chat_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    ownerIdentityIdx: uniqueIndex("usage_subject_owner_identity_idx").on(
      table.ownerType,
      table.ownerId
    ),
    fingerprintIdx: index("usage_subject_fingerprint_idx").on(
      table.fingerprintHash
    ),
  })
);

export const documents = pgTable(
  "document",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    documentId: text("document_id").notNull().unique(),
    ownerType: ownerTypeEnum("owner_type").notNull(),
    ownerId: text("owner_id").notNull(),
    fileName: text("file_name").notNull(),
    status: documentStatusEnum("status").notNull().default("queued"),
    chunksIndexed: integer("chunks_indexed"),
    chatsUsed: integer("chats_used").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    ownerIdx: index("document_owner_idx").on(table.ownerType, table.ownerId),
  })
);
