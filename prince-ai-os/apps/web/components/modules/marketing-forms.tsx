"use client";
import { createCampaignAction, updateCampaignAction } from "@/lib/module-actions";
import { InputField, SelectField, TextareaField, type FieldErrors } from "./field";
import type { Option } from "./options";
import { RecordForm } from "./record-form";

export interface CampaignDefaults {
  name: string;
  objective: string;
  audience: string;
  channels: string[];
  budgetUsd: number | null;
  startsOn: string | null;
  endsOn: string | null;
  notes: string;
}

function CampaignFields({
  f,
  errors,
  businesses,
  defaults,
}: {
  f: string;
  errors: FieldErrors;
  businesses?: Option[];
  defaults?: CampaignDefaults;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {businesses &&
        (businesses.length > 1 ? (
          <SelectField
            form={f}
            name="businessId"
            label="Business"
            errors={errors}
            options={businesses}
            className="sm:col-span-2"
          />
        ) : (
          <input type="hidden" name="businessId" value={businesses[0]?.value ?? ""} />
        ))}
      <InputField
        form={f}
        name="name"
        label="Campaign name"
        errors={errors}
        defaultValue={defaults?.name}
        maxLength={120}
        className="sm:col-span-2"
        required
      />
      <TextareaField
        form={f}
        name="objective"
        label="Objective"
        errors={errors}
        defaultValue={defaults?.objective}
        maxLength={1000}
        rows={2}
        className="sm:col-span-2"
        required
      />
      <TextareaField
        form={f}
        name="audience"
        label="Audience"
        errors={errors}
        defaultValue={defaults?.audience}
        maxLength={2000}
        rows={2}
        className="sm:col-span-2"
      />
      <InputField
        form={f}
        name="channels"
        label="Channels"
        errors={errors}
        defaultValue={defaults?.channels.join(", ")}
        hint="Comma separated, e.g. Meta ads, Google search"
        className="sm:col-span-2"
      />
      <InputField
        form={f}
        name="budgetUsd"
        label="Planned budget (USD)"
        errors={errors}
        defaultValue={defaults?.budgetUsd == null ? "" : String(defaults.budgetUsd)}
        type="number"
        inputMode="decimal"
        min="0"
        step="0.01"
      />
      <div className="hidden sm:block" />
      <InputField
        form={f}
        name="startsOn"
        label="Start date"
        errors={errors}
        defaultValue={defaults?.startsOn ?? ""}
        type="date"
      />
      <InputField
        form={f}
        name="endsOn"
        label="End date"
        errors={errors}
        defaultValue={defaults?.endsOn ?? ""}
        type="date"
      />
      <TextareaField
        form={f}
        name="notes"
        label="Notes"
        errors={errors}
        defaultValue={defaults?.notes}
        maxLength={5000}
        rows={3}
        className="sm:col-span-2"
      />
    </div>
  );
}

export function NewCampaignForm({ businesses }: { businesses: Option[] }) {
  return (
    <RecordForm
      label="New campaign"
      action={createCampaignAction}
      submitLabel="Plan campaign"
      redirect={{ prefix: "/marketing/", key: "campaignId" }}
    >
      {(errors) => <CampaignFields f="new-campaign" errors={errors} businesses={businesses} />}
    </RecordForm>
  );
}

export function EditCampaignForm({ id, defaults }: { id: string; defaults: CampaignDefaults }) {
  return (
    <RecordForm
      label="Edit campaign"
      action={(values) => updateCampaignAction(id, values)}
      submitLabel="Save changes"
    >
      {(errors) => <CampaignFields f="edit-campaign" errors={errors} defaults={defaults} />}
    </RecordForm>
  );
}
