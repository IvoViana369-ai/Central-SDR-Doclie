-- CreateTable
CREATE TABLE "login_throttles" (
    "key" TEXT NOT NULL,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "window_started_at" TIMESTAMPTZ(3) NOT NULL,
    "blocked_until" TIMESTAMPTZ(3),
    "alerted_at" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_throttles_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "login_throttles_updated_at_idx" ON "login_throttles"("updated_at");
