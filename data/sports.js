/**
 * sports.js — PSV Sports Academy: Single source of truth for all sports.
 *
 * ✅ TO ADD A NEW SPORT: just add a new entry here. Nothing else changes.
 *
 * Fields:
 *   name         — Display name shown in the sport selection list
 *   description  — Subtitle shown under the name in the WhatsApp list message
 *   hasSubOptions — true = show a sub-menu before asking name (e.g. Badminton)
 *   options      — Sub-option map (only when hasSubOptions: true)
 *     └─ title   — Button label in the WhatsApp button message
 *     └─ tabName — Supabase tab tracking category to categorise this lead
 *     └─ message — Info text sent to user after lead is collected
 *   tabName      — (direct sports only) Supabase tab tracking category
 *   message      — (direct sports only) Info text sent after lead collection
 */

const sports = {

  badminton: {
    name: "🏸 Badminton",
    description: "Coaching, Court Booking & Play Sessions",
    hasSubOptions: true,
    options: {
      badminton_coaching: {
        title: "🎓 Coaching",
        tabName: "Badminton - Coaching",
        message:
          `🏸 *PSV Badminton Academy — Coaching*\n\n` +
          `⏰ *Adult Batches:*\n` +
          `• 6:30 AM – 8:30 AM\n` +
          `• 7:30 AM – 9:30 AM\n` +
          `• 8:30 AM – 10:30 AM\n` +
          `• 6:30 PM – 8:30 PM\n` +
          `• 7:30 PM – 9:30 PM\n` +
          `• 8:30 PM – 10:30 PM\n\n` +
          `👦 *Kids Batches:*\n` +
          `• 5:00 PM – 6:30 PM\n` +
          `• Parents accompanying kids can also attend!\n` +
          `• Weekend sessions available ✅\n\n` +
          `💰 *Adult Packages:*\n` +
          `1. 20 days/month — ₹4,000\n` +
          `2. 16 days/month — ₹3,500\n` +
          `3. 12 days/month — ₹3,000\n` +
          `4. 8 days/month — ₹2,500\n` +
          `5. 30 sessions in 2 months — ₹5,000\n\n` +
          `💰 *Kids Packages:*\n` +
          `1. 20 days/month — ₹3,000\n` +
          `2. 12 days/month — ₹2,500\n` +
          `3. 8 days/month — ₹2,000\n\n` +
          `📞 Call/WhatsApp: *+91 9509502000*\n\n` +
          `📍 *Locations:*\n` +
          `1. PSV Badminton Court, Shareca Lane, Behind Joy Alukkas Gold Tower, Vazhakkala\n` +
          `https://maps.app.goo.gl/SQ7LZMtDhCpwepsh6\n` +
          `2. Nava Sports Center, Annex Road, Desiyamukku, Vazhakkala\n\n` +
          `https://maps.app.goo.gl/N7VYk8C4q7XeTWZB6\n` ,
      },

      badminton_court: {
        title: "🏟️ Court Booking",
        tabName: "Badminton - Court Booking",
        message:
          `🏸 *PSV Badminton — Court Booking*\n\n` +
          `We have 2 court locations in Vazhakkala & Desiyamukku!\n\n` +
          `1️⃣ *PSV Badminton Court*\n` +
          `📍 https://maps.app.goo.gl/SQ7LZMtDhCpwepsh6\n` +
          `🔗 Book: https://book.playspots.in/venues/psv-badminton-academy-shareca-lane-vazhakkala\n\n` +
          `2️⃣ *PSV–Nava Badminton Court*\n` +
          `📍 https://maps.app.goo.gl/N7VYk8C4q7XeTWZB6\n` +
          `🔗 Book: https://book.playspots.in/venues/nava-sports-centre\n\n` +
          `For group/monthly bookings:\n` +
          `📞 *+91 9509502000*`,
      },

      badminton_play_session: {
        title: "🏸 Play Sessions",
        tabName: "Badminton - Play Sessions",
        message:
          `🏸 *PSV Badminton — Play Sessions*\n\n` +
          `Join our open play sessions at PSV Badminton Courts!\n\n` +
          `📍 *Locations:*\n` +
          `1. PSV Badminton Court, Shareca Lane, Vazhakkala\n` +
          `https://maps.app.goo.gl/SQ7LZMtDhCpwepsh6\n` +
          `2. Nava Sports Center, Annex Road, Vazhakkala\n` +
          `https://maps.app.goo.gl/N7VYk8C4q7XeTWZB6\n\n` +
          `🔗 *Book online:*\n` +
          `https://book.playspots.in/venues/psv-badminton-academy-shareca-lane-vazhakkala\n\n` +
          `📞 For group bookings: *+91 9509502000*`,
      },
    },
  },

  archery: {
    name: "🏹 Archery",
    hasSubOptions: false,
    tabName: "Archery",
    message:
      `🏹 *Archery Classes by PSV*\n\n` +
      `Professional coaching by Pro Sports Ventures (PSV)\n\n` +
      `📍 *Location:* Nava Nirman School, Annex Road, Desiyamukku, Vazhakkala\n` +
      `https://maps.app.goo.gl/N7VYk8C4q7XeTWZB6\n`+
      `🗓 *Days:* Monday – Friday\n` +
      `⏰ *Time:* 4:00 PM – 6:00 PM\n\n` +
      `💰 *Packages:*\n` +
      `• ₹2,500 — 2 days/week (8 sessions/month)\n` +
      `• ₹3,000 — 3 days/week (12 sessions/month)\n\n` +
      `🎯 Classes start: 1st week of April\n` +
      `📞 Book a FREE demo: *+91 9509502000*`,
  },

basketball: {
  name: "🏀 Basketball",
  hasSubOptions: false,
  tabName: "Basketball",
  message:
    `🏀 *Basketball Coaching — Adults & Kids*\n\n` +

    `Structured, performance-driven training for beginners to advanced players at ABC Indoor Basketball Academy.\n\n` +

    `⏰ *Batch Timings*\n\n` +

    `👦 Beginners (Under 15)\n` +
    `• 6:15 PM – 7:30 PM | Mon – Thu\n\n` +

    `🧑 Beginners (Above 15 years)\n` +
    `• 5:00 PM – 6:30 PM | Fri, Sat & Sun\n\n` +

    `🏀 Intermediate / Advanced / Pro\n` +
    `• 7:30 PM – 9:30 PM | Mon – Fri\n\n` +

    `💰 *Packages*\n` +
    `• 12 Sessions — ₹2,500\n` +
    `• 15 Sessions — ₹3,500\n` +
    `• 20 Sessions — ₹4,000\n\n` +

    `⭐ *Additional Services*\n` +
    `• Personal Training (15 sessions) — ₹5,000\n` +
    `• Team Training — ₹2,000/session\n` +
    `• Court Booking — ₹1,200/hour\n\n` +

    `📍 *Location:* Nava Sports, Vazhakkala\n` +
    `https://maps.app.goo.gl/MuZtZsZLMcjAXfQK9\n\n` +

    `🎯 *Free demo session available*\n` +
    `📞 Call/WhatsApp: *+91 9509502000*`,
},

  roller_skating: {
    name: "🛼 Roller Skating",
    hasSubOptions: false,
    tabName: "Roller Skating",
    message:
      `🛼 *Roller Skating Classes — Adults & Kids*\n\n` +
      `🎯 Structured & monitored sessions\n` +
      `👨‍🏫 Expert coaches\n` +
      `⚖️ Balance • Fitness • Confidence\n\n` +
      `👶 Kids: 3 years onwards\n` +
      `🧑 Adults: No age limit!\n\n` +
      `💰 *Fees:*\n` +
      `• 2 sessions/week — ₹2,500/month\n` +
      `• 3 sessions/week — ₹3,500/month\n\n` +
      `📍 *Location:* Nava Nirman School, Vayu Sena Road, Kakkanad\n` +
      `🗺 https://maps.app.goo.gl/MuZtZsZLMcjAXfQK9\n\n` +
      `⏰ Mon – Thu | 4:00 PM – 6:00 PM\n\n` +
      `🎁 *Free demo session available for everyone!*\n` +
      `📞 Call/WhatsApp: *+91 9509502000*`,
  },

};

module.exports = sports;
