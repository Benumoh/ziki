/**
 * The marketing task types every organisation starts with. Types belong to the
 * organisation, so all its projects share them. New organisations get these when they
 * are created; migration 20270108000000_marketing_defaults gave them to existing
 * ones, and 20270208000000_marketing_task_type_goals their goals. Change those
 * migrations' lists only by adding a new migration.
 */
export const DEFAULT_MARKETING_TASK_TYPES = [
  { name: "Blog post", description: "A post on the project's blog.", goal: "Grow organic search traffic and build trust with helpful, well-researched posts that answer the questions your audience is searching for." },
  { name: "Social post", description: "A post or thread on a social network.", goal: "Grow an engaged following and drive visits to the site with regular posts and threads where your audience already spends time." },
  { name: "Email or newsletter", description: "An email or newsletter sent to the project's audience.", goal: "Keep subscribers and customers coming back with useful updates, launches and stories that lead them to act." },
  { name: "Landing page copy", description: "Copy for a page on the website.", goal: "Turn more visitors into sign-ups with clear, persuasive copy that explains the value of the product in seconds." },
  { name: "Graphic", description: "An image or visual asset.", goal: "Make the brand recognisable and every post and page more engaging with consistent, eye-catching visuals." },
  { name: "Video", description: "A video or short clip.", goal: "Show the product in action and reach new audiences with short videos and clips that are easy to share." },
  { name: "Case study", description: "A write-up of how someone used the product.", goal: "Win the trust of new customers by showing real results others have achieved with the product." },
  { name: "Outreach", description: "Reaching out to a person, community or publication.", goal: "Earn mentions, links and partnerships by reaching the people, communities and publications your audience follows." },
] as const;
