# 🏆 PSV Sports Academy — WhatsApp Bot Setup Guide
### Complete Beginner's Guide (Step by Step)

---

## 📁 Project File Structure

```
psv-whatsapp-bot/
├── server.js       ← Main server (handles webhook)
├── bot.js          ← Conversation logic & state
├── whatsapp.js     ← Functions to send WhatsApp messages
├── csv.js          ← Save leads to CSV file
├── leads.csv       ← Auto-created when first lead arrives
├── .env            ← Your secret keys (never share this!)
├── .env.example    ← Template for .env
└── package.json    ← Project dependencies
```

---

## 🛠️ PART 1: Install Required Software

### Step 1: Install Node.js
1. Go to **https://nodejs.org**
2. Download the **LTS version** (e.g., 20.x)
3. Install it (click Next → Next → Finish)
4. Verify: Open **Command Prompt** and type:
   ```
   node --version
   ```
   You should see something like `v20.10.0`

### Step 2: Create Project Folder
```bash
# Open Command Prompt (Windows) or Terminal (Mac/Linux)
mkdir psv-whatsapp-bot
cd psv-whatsapp-bot
```

### Step 3: Copy All Project Files
Place all the provided `.js` files, `package.json`, and `.env.example` into this folder.

### Step 4: Install Dependencies
```bash
npm install
```
This installs: Express, Axios, dotenv, body-parser.

---

## 🌐 PART 2: Get Your WhatsApp API Credentials

### Step 1: Create a Meta Developer Account
1. Go to **https://developers.facebook.com**
2. Log in with your Facebook account
3. Click **"Get Started"** or **"My Apps"**

### Step 2: Create a New App
1. Click **"Create App"**
2. Select **"Business"** as app type
3. Enter App Name: `PSV Sports Bot`
4. Enter your business email
5. Click **"Create App"**

### Step 3: Add WhatsApp Product
1. In your app dashboard, scroll down to find **"WhatsApp"**
2. Click **"Set up"**
3. You'll see the **WhatsApp API Setup** page

### Step 4: Get Your Credentials
On the WhatsApp API Setup page, you'll see:

```
Phone Number ID: 123456789012345   ← Copy this
Access Token:    EAAxxxxx...       ← Copy this (valid 24 hours)
```

> ⚠️ **Important**: The Access Token expires in 24 hours for testing.
> For permanent use, you need a **System User Token** (covered in Part 5).

### Step 5: Add a Test Phone Number
- Meta gives you a **free test number** for development
- You can send messages FROM this number TO your personal WhatsApp
- Add your WhatsApp number as a recipient (you get 5 free test recipients)

---

## ⚙️ PART 3: Configure Your .env File

1. Copy `.env.example` to a new file called `.env`:
   ```bash
   copy .env.example .env    # Windows
   cp .env.example .env      # Mac/Linux
   ```

2. Open `.env` and fill in your values:
   ```
   PHONE_NUMBER_ID=123456789012345
   ACCESS_TOKEN=EAAxxxxx...your_token_here
   VERIFY_TOKEN=psv_sports_token_2024
   PORT=3000
   ```

---

## 📡 PART 4: Set Up Your Webhook (Make Server Public)

Meta needs to reach your server from the internet. Since your laptop is not
publicly accessible, use **ngrok** (a free tool that creates a public URL).

### Step 1: Install ngrok
1. Go to **https://ngrok.com**
2. Sign up for free
3. Download ngrok for your OS
4. Follow their quick setup to authenticate

### Step 2: Start Your Bot Server
```bash
# In your project folder:
node server.js
```
You should see:
```
🚀 PSV Bot server running on port 3000
```

### Step 3: Start ngrok (in a NEW terminal window)
```bash
ngrok http 3000
```
You'll see output like:
```
Forwarding   https://abc123.ngrok-free.app → http://localhost:3000
```
Copy that `https://abc123.ngrok-free.app` URL.

### Step 4: Register Webhook with Meta
1. In Meta Developer Dashboard → Your App → WhatsApp → Configuration
2. Click **"Edit"** next to Webhook
3. Fill in:
   - **Callback URL**: `https://abc123.ngrok-free.app/webhook`
   - **Verify Token**: `psv_sports_token_2024` (same as in your .env)
4. Click **"Verify and Save"**
5. You should see ✅ Verified!

### Step 5: Subscribe to Messages
After verifying, click **"Manage"** next to Webhooks and enable:
- ✅ `messages`

---

## 🧪 PART 5: Test Your Bot

1. Open WhatsApp on your phone
2. Send **any message** to the test number Meta gave you
3. You should receive the welcome message with sport options!

### What to Expect:
```
User sends: "Hi"
Bot replies: "👋 Welcome to PSV Sports Academy, [Your Name]!
             Please select the sport you're interested in:"
             [List: Badminton, Cricket, Archery, Roller Skating]

User selects: Badminton
Bot replies:  [Badminton info with fees & timings]
              "Would you like to share your address?"
              [Buttons: Share Address | Skip]

User clicks:  Skip
Bot replies:  "✅ Thank you! Your enquiry has been registered..."
```

Your `leads.csv` file will have a new row! ✅

---

## 🔒 PART 6: Get a Permanent Access Token (For Production)

The temporary token expires every 24 hours. For your live bot:

1. In Meta Developer Dashboard → Business Settings
2. Go to **System Users** → Add a System User
3. Give it **Admin** role
4. Generate a token with `whatsapp_business_messaging` permission
5. This token does NOT expire

Replace the `ACCESS_TOKEN` in your `.env` with this permanent token.

---

## 🚀 PART 7: Deploy to a Real Server (Free Option)

For a permanent public URL (instead of ngrok), use **Railway.app**:

1. Go to **https://railway.app** and sign up
2. Connect your GitHub account
3. Push your code to GitHub (without the `.env` file!)
4. In Railway, add your environment variables manually
5. Railway gives you a permanent URL like `https://psv-bot.railway.app`
6. Update your webhook URL in Meta Developer Dashboard

---

## 📊 PART 8: Download CSV for CRM Import

Your leads are saved in `leads.csv` in your project folder.

**CSV Columns:**
| Column | Example |
|--------|---------|
| Customer Name | Rahul Sharma |
| Mobile Number | 919876543210 |
| Lead Category | 🏸 Badminton |
| Address | Koramangala, Bangalore |
| Lead Source | WhatsApp Bot |
| Priority | Medium |
| Lead Status | New |
| Created At | 25/03/2024, 10:30:00 AM |

To upload to Login2Pro CRM:
1. Download `leads.csv`
2. In Login2Pro, find the **"Import Leads"** or **"Upload CSV"** option
3. Map the columns to match their fields
4. Import!

---

## 🐛 Troubleshooting

| Problem | Solution |
|---------|----------|
| Webhook verification fails | Check VERIFY_TOKEN matches in .env and Meta Dashboard |
| Bot doesn't reply | Check ACCESS_TOKEN is not expired |
| "Phone Number ID not found" | Verify PHONE_NUMBER_ID is correct (it's a number, not the phone number) |
| ngrok URL changed | ngrok URL changes each restart — re-register webhook |
| leads.csv not created | Bot creates it automatically when first lead is saved |

---

## 📞 Quick Reference

```bash
# Start the bot
node server.js

# Start with auto-restart on file changes (development)
npm run dev

# View leads
cat leads.csv         # Mac/Linux
type leads.csv        # Windows
```

---

*PSV Sports Academy Bot — Built with ❤️ using Meta WhatsApp Cloud API*
