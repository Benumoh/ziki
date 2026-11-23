import Link from "next/link";
import { requireSuperAdmin } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { getPlatformRewardConfig } from "@/lib/rewards/platform";
import { feePercent } from "@/lib/coins/math";
import { PlatformRewardsForm } from "@/components/platform-rewards-form";

export const metadata = { title: "Platform rewards" };

export default async function AdminRewardsPage() {
  await requireSuperAdmin();
  const initial = await getPlatformRewardConfig(prisma);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <p className="text-sm">
          <Link href="/superadmin/users" className="font-medium text-zk-accent hover:underline">
            ← Site admin
          </Link>
        </p>
        <h1 className="mt-2 text-xl font-semibold text-zk-text sm:text-2xl">Platform rewards</h1>
        <p className="mt-1 max-w-2xl text-sm text-zk-text2">
          Ziks are the only payment: each funded issue pays everyone who worked on it once it&apos;s live, the same split in
          every project. Here you set the ranking goal and the guidelines projects show when they set none.
        </p>
      </div>
      <PlatformRewardsForm initial={initial} fee={feePercent()} />
    </div>
  );
}
