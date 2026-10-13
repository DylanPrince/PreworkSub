"use client";
import { createFinanceEntryAction } from "@/lib/module-actions";
import { InputField, SelectField } from "./field";
import { SOURCE_OPTIONS, today, type Option } from "./options";
import { RecordForm } from "./record-form";

/** Records one revenue, cost or expense entry. */
export function FinanceEntryForm({
  businesses,
  kinds,
  defaultBusinessId,
}: {
  businesses: Option[];
  kinds: Option[];
  defaultBusinessId?: string;
}) {
  const f = "fin";
  return (
    <RecordForm
      label="New finance entry"
      action={createFinanceEntryAction}
      submitLabel="Add entry"
      after="reset"
    >
      {(errors) => (
        <div className="grid grid-cols-2 gap-4">
          {businesses.length > 1 ? (
            <SelectField
              form={f}
              name="businessId"
              label="Business"
              errors={errors}
              options={businesses}
              defaultValue={defaultBusinessId ?? businesses[0]?.value}
              className="col-span-2"
            />
          ) : (
            <input type="hidden" name="businessId" value={businesses[0]?.value ?? ""} />
          )}
          <SelectField
            form={f}
            name="kind"
            label="Type"
            errors={errors}
            options={kinds}
            className="col-span-2"
          />
          <InputField
            form={f}
            name="amountUsd"
            label="Amount (USD)"
            errors={errors}
            type="number"
            inputMode="decimal"
            min="0.01"
            step="0.01"
            required
          />
          <InputField
            form={f}
            name="occurredOn"
            label="Date"
            errors={errors}
            type="date"
            defaultValue={today()}
            suppressHydrationWarning
            required
          />
          <InputField
            form={f}
            name="description"
            label="Description"
            errors={errors}
            maxLength={300}
            placeholder="e.g. Shopify payout, week 41"
            className="col-span-2"
            required
          />
          <SelectField
            form={f}
            name="source"
            label="This figure is"
            errors={errors}
            options={SOURCE_OPTIONS}
            className="col-span-2"
          />
        </div>
      )}
    </RecordForm>
  );
}
