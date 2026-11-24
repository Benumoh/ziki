import { DocsArticle, DocsBlock, DocsLink, DocsList, DocsNote, DocsP, DocsSteps, UiLabel } from "@/components/docs-article";

export const metadata = {
  title: "Withdrawing your balance",
  description: "Set up payouts once with Stripe, then withdraw what you earn on Ziki to your bank account.",
};

export default function WithdrawingPage() {
  return (
    <DocsArticle
      href="/docs/users/withdrawing"
      inShort={
        <>
          Once you have earned 30,000 Ziks ($30), you can withdraw them to your bank account. Add your bank account
          through Stripe once, then press <UiLabel>Withdraw</UiLabel>. The money usually arrives within a few days.
        </>
      }
      related={[
        { href: "/docs/users/earning", label: "Earning money" },
        { href: "/coins", label: "Your Ziks" },
        { href: "/earnings", label: "Your earnings" },
      ]}
    >
      <DocsBlock title="Before you start">
        <DocsList>
          <li>
            <UiLabel>Withdrawals open at 30,000 Ziks.</UiLabel> Until then, <UiLabel>Withdraw</UiLabel> shows how much you have
            and how much is still to go.
          </li>
          <li>
            Only money that has been paid counts. Money still <UiLabel>Being checked</UiLabel> (work that isn&apos;t
            confirmed live yet) can&apos;t be withdrawn until it is paid.
          </li>
          <li>
            The <UiLabel>Ziks</UiLabel> amount at the top of the page is everything you earned, in every
            organisation. It all comes into one Ziks wallet, and you withdraw from that.
          </li>
          <li>
            Only earned Ziks can be withdrawn. Ziks you bought are for funding work. Spending uses bought Ziks first.
          </li>
        </DocsList>
      </DocsBlock>

      <DocsBlock title="1. Set up payouts (once)">
        <DocsSteps>
          <li>
            Open the <DocsLink href="/coins">Your Ziks</DocsLink> page (<UiLabel>Buy Ziks</UiLabel> in your menu).
          </li>
          <li>
            Press <UiLabel>Set up payouts</UiLabel>. Stripe, Ziki&apos;s payment partner, opens.
          </li>
          <li>Follow Stripe&apos;s steps to add your bank account.</li>
          <li>
            Back on Ziki, the page says <UiLabel>Payouts are set up.</UiLabel> If it says{" "}
            <UiLabel>Finish payout setup</UiLabel>, Stripe still needs a few details: press it and finish.
          </li>
        </DocsSteps>
        <DocsNote title="Your bank details stay with Stripe">
          You enter them on Stripe&apos;s own pages, not on Ziki.
        </DocsNote>
      </DocsBlock>

      <DocsBlock title="2. Withdraw">
        <DocsSteps>
          <li>
            Press <UiLabel>Withdraw</UiLabel> next to the <UiLabel>Ziks</UiLabel> amount at the top of any page, or in
            your menu. Once you have reached 30,000 Ziks, the window says <UiLabel>Withdraw is open</UiLabel>.
          </li>
          <li>
            Press <UiLabel>Withdraw</UiLabel> in the window. It takes you to the <UiLabel>Withdraw</UiLabel> page,
            which shows how many Ziks you can withdraw.
          </li>
          <li>
            Press <UiLabel>Withdraw</UiLabel> there to send it to your bank account.
          </li>
        </DocsSteps>
        <DocsP>
          Ziki shows <UiLabel>We&apos;ll send it to your bank account automatically, usually within a few days.</UiLabel>{" "}
          When it has left, the message changes to <UiLabel>It&apos;s on its way to your bank account.</UiLabel>
        </DocsP>
      </DocsBlock>

      <DocsBlock title="Not at 30,000 Ziks yet?">
        <DocsP>
          The Withdraw window has <UiLabel>Find more tasks</UiLabel>, and your{" "}
          <DocsLink href="/earnings">earnings page</DocsLink> lists the open tasks that pay the most. See{" "}
          <DocsLink href="/docs/users/earning">Earning money</DocsLink> for every way to earn.
        </DocsP>
      </DocsBlock>
    </DocsArticle>
  );
}
