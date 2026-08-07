delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SECRET_KEY;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.CRM_WEBHOOK_URL;
delete process.env.ADMIN_ALERT_WEBHOOK_URL;

process.env.MESSAGING_PROVIDER = "mock";
process.env.ENABLE_CHECKIN_REMINDERS = "true";
process.env.APP_BASE_URL = "https://hometogether.test";

