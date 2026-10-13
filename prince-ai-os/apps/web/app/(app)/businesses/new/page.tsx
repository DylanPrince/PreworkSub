import { BusinessForm } from "@/components/businesses/business-form";
import { PageHeader } from "@/components/common/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { requireUser } from "@/lib/session";

export const metadata = { title: "New business" };

export default async function NewBusinessPage() {
  await requireUser();
  return (
    <div>
      <PageHeader
        title="New business"
        description="Each business is an isolated workspace: its tasks, runs and costs are visible only to its members."
      />
      <Card>
        <CardContent className="pt-5">
          <BusinessForm />
        </CardContent>
      </Card>
    </div>
  );
}
