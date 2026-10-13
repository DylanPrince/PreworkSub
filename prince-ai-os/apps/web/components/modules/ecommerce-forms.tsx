"use client";
import { useState } from "react";
import {
  createProductAction,
  createSupplierAction,
  updateProductAction,
} from "@/lib/module-actions";
import { InputField, SelectField, TextareaField, type FieldErrors } from "./field";
import { SOURCE_OPTIONS, type Option } from "./options";
import { RecordForm } from "./record-form";

export interface ProductDefaults {
  name: string;
  description: string;
  stage: string;
  supplierId: string | null;
  priceUsd: number | null;
  unitCostUsd: number | null;
  shippingCostUsd: number | null;
  feePercent: number | null;
  feeFixedUsd: number | null;
  source: string;
  notes: string;
}

const str = (n: number | null | undefined) => (n == null ? "" : String(n));

function ProductFields({
  f,
  errors,
  businesses,
  suppliers,
  stages,
  defaults,
}: {
  f: string;
  errors: FieldErrors;
  businesses?: Option[];
  suppliers: (Option & { businessId?: string })[];
  stages: Option[];
  defaults?: ProductDefaults;
}) {
  const [businessId, setBusinessId] = useState(businesses?.[0]?.value ?? "");
  const choices = suppliers.filter((s) => !s.businessId || s.businessId === businessId);
  const money = { type: "number", inputMode: "decimal", min: "0", step: "0.01" } as const;
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
            value={businessId}
            onChange={(e) => setBusinessId(e.target.value)}
          />
        ) : (
          <input type="hidden" name="businessId" value={businessId} />
        ))}
      <InputField
        form={f}
        name="name"
        label="Product name"
        errors={errors}
        defaultValue={defaults?.name}
        maxLength={120}
        required
      />
      <SelectField
        form={f}
        name="stage"
        label="Stage"
        errors={errors}
        options={stages}
        defaultValue={defaults?.stage ?? "idea"}
      />
      <SelectField
        form={f}
        name="supplierId"
        label="Supplier"
        errors={errors}
        options={[{ value: "", label: "None yet" }, ...choices]}
        defaultValue={defaults?.supplierId ?? ""}
      />
      <TextareaField
        form={f}
        name="description"
        label="Description"
        errors={errors}
        defaultValue={defaults?.description}
        maxLength={5000}
        className="sm:col-span-2"
      />
      <fieldset className="grid gap-4 sm:col-span-2 sm:grid-cols-3">
        <legend className="mb-2 text-xs font-medium text-muted-foreground">
          Unit economics (USD). Leave a figure blank if you do not know it yet.
        </legend>
        <InputField
          form={f}
          name="priceUsd"
          label="Selling price"
          errors={errors}
          defaultValue={str(defaults?.priceUsd)}
          {...money}
        />
        <InputField
          form={f}
          name="unitCostUsd"
          label="Unit cost"
          errors={errors}
          defaultValue={str(defaults?.unitCostUsd)}
          {...money}
        />
        <InputField
          form={f}
          name="shippingCostUsd"
          label="Shipping per unit"
          errors={errors}
          defaultValue={str(defaults?.shippingCostUsd)}
          {...money}
        />
        <InputField
          form={f}
          name="feePercent"
          label="Payment/platform fee (%)"
          errors={errors}
          defaultValue={str(defaults?.feePercent)}
          {...money}
          max="100"
        />
        <InputField
          form={f}
          name="feeFixedUsd"
          label="Fixed fee per order"
          errors={errors}
          defaultValue={str(defaults?.feeFixedUsd)}
          {...money}
        />
        <SelectField
          form={f}
          name="source"
          label="These figures are"
          errors={errors}
          options={SOURCE_OPTIONS}
          defaultValue={defaults?.source ?? "user_entered"}
        />
      </fieldset>
      <TextareaField
        form={f}
        name="notes"
        label="Notes"
        errors={errors}
        defaultValue={defaults?.notes}
        maxLength={5000}
        className="sm:col-span-2"
      />
    </div>
  );
}

export function NewProductForm({
  businesses,
  suppliers,
  stages,
}: {
  businesses: Option[];
  suppliers: (Option & { businessId: string })[];
  stages: Option[];
}) {
  return (
    <RecordForm
      label="New product"
      action={createProductAction}
      submitLabel="Add product"
      redirect={{ prefix: "/ecommerce/products/", key: "productId" }}
    >
      {(errors) => (
        <ProductFields
          f="new-product"
          errors={errors}
          businesses={businesses}
          suppliers={suppliers}
          stages={stages}
        />
      )}
    </RecordForm>
  );
}

export function EditProductForm({
  productId,
  suppliers,
  stages,
  defaults,
}: {
  productId: string;
  suppliers: Option[];
  stages: Option[];
  defaults: ProductDefaults;
}) {
  return (
    <RecordForm
      label="Edit product"
      action={(values) => updateProductAction(productId, values)}
      submitLabel="Save changes"
    >
      {(errors) => (
        <ProductFields
          f="edit-product"
          errors={errors}
          suppliers={suppliers}
          stages={stages}
          defaults={defaults}
        />
      )}
    </RecordForm>
  );
}

export function SupplierForm({ businesses }: { businesses: Option[] }) {
  const f = "supplier";
  return (
    <RecordForm
      label="New supplier"
      action={createSupplierAction}
      submitLabel="Add supplier"
      after="reset"
    >
      {(errors) => (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {businesses.length > 1 ? (
            <SelectField
              form={f}
              name="businessId"
              label="Business"
              errors={errors}
              options={businesses}
            />
          ) : (
            <input type="hidden" name="businessId" value={businesses[0]?.value ?? ""} />
          )}
          <InputField
            form={f}
            name="name"
            label="Supplier name"
            errors={errors}
            maxLength={120}
            required
          />
          <InputField
            form={f}
            name="website"
            label="Website"
            errors={errors}
            type="url"
            placeholder="https://"
          />
          <InputField form={f} name="contact" label="Contact" errors={errors} maxLength={200} />
          <InputField
            form={f}
            name="leadTimeDays"
            label="Lead time (days)"
            errors={errors}
            type="number"
            min="0"
            step="1"
          />
          <InputField
            form={f}
            name="minimumOrder"
            label="Minimum order (units)"
            errors={errors}
            type="number"
            min="0"
            step="1"
          />
          <TextareaField
            form={f}
            name="notes"
            label="Notes"
            errors={errors}
            maxLength={5000}
            className="sm:col-span-2"
          />
        </div>
      )}
    </RecordForm>
  );
}
