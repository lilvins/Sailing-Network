#!/bin/bash
echo "🔄 Resetting dev environment..."
echo "Killing processes..."
killall -9 node vite 2>/dev/null || true
sleep 2
echo "Removing old DB..."
rm -f server/sailing.db
echo "Seeding..."
node server/seed-admin.mjs admin@sailing.local admin admin12345 2>&1 | tail -3
node server/seed-demo.mjs 2>&1 | tail -3
echo "✅ Done! Run: npm run server & npm run dev"
