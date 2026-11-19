/**
 * The marketing task types every organisation starts with, in the order the Marketing tabs show them. A Videos
 * asset's page holds the video studio. Types belong to the
 * organisation, so all its projects share them. New organisations get these when they
 * are created; migration 20270108000000_marketing_defaults gave them to existing
 * ones, 20270208000000_marketing_task_type_goals their goals, and 20270221000000_marketing_tab_types moved them to
 * this list (renaming, adding SEO, folding the rest into the tab their work belongs to). Change those
 * migrations' lists only by adding a new migration.
 */
export const DEFAULT_MARKETING_TASK_TYPES = [
  { name: "Landing Pages", description: "Pages and copy on the website.", goal: "Turn more visitors into sign-ups with clear, persuasive pages that explain the value of the product in seconds." },
  { name: "Content Marketing", description: "Blog posts, guides, case studies and newsletters.", goal: "Grow organic traffic and build trust with helpful content that answers the questions your audience is asking." },
  { name: "Social Media", description: "Posts and threads on social networks.", goal: "Grow an engaged following and drive visits to the site with regular posts and threads where your audience already spends time." },
  { name: "Outreach", description: "Reaching out to a person, community or publication.", goal: "Earn mentions, links and partnerships by reaching the people, communities and publications your audience follows." },
  { name: "SEO", description: "How the site is found in search.", goal: "Get found by the people searching for what you offer, by improving the site's rankings, structure and keywords." },
  { name: "Videos", description: "Videos and short clips, each made in the video studio.", goal: "Show the product in action and reach new audiences with short videos and clips that are easy to share." },
] as const;
