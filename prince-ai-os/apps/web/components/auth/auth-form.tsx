"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { useHydrated } from "@/lib/use-hydrated";
import { Card, CardContent } from "@/components/ui/card";
import { FieldError, Input, Label } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";

const signInSchema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(1, "Enter your password"),
});
const signUpSchema = z.object({
  name: z.string().trim().min(1, "Enter your name").max(80),
  email: z.string().email("Enter a valid email"),
  password: z.string().min(12, "Use at least 12 characters").max(128),
});

type Values = { name?: string; email: string; password: string };

export function AuthForm({ mode }: { mode: "sign-in" | "sign-up" }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<Values>({
    resolver: zodResolver(mode === "sign-in" ? signInSchema : signUpSchema) as never,
    defaultValues: { name: "", email: "", password: "" },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    const res =
      mode === "sign-in"
        ? await authClient.signIn.email({ email: values.email, password: values.password })
        : await authClient.signUp.email({
            name: values.name ?? "",
            email: values.email,
            password: values.password,
          });
    if (res.error) {
      setError(res.error.message ?? "Authentication failed");
      return;
    }
    router.push("/");
    router.refresh();
  });

  return (
    <Card>
      <CardContent className="pt-5">
        <h1 className="text-base font-semibold">
          {mode === "sign-in" ? "Sign in" : "Create the owner account"}
        </h1>
        <p className="mt-1 text-xs text-muted-foreground">
          {mode === "sign-in"
            ? "Access your AI operating system."
            : "The first account becomes the owner. Further sign-ups are closed unless enabled."}
        </p>
        <form onSubmit={onSubmit} className="mt-5 flex flex-col gap-3" method="post" noValidate>
          {mode === "sign-up" && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                autoComplete="name"
                aria-invalid={!!errors.name}
                aria-describedby="name-error"
                {...form.register("name")}
              />
              <FieldError id="name-error" message={errors.name?.message} />
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              aria-invalid={!!errors.email}
              aria-describedby="email-error"
              {...form.register("email")}
            />
            <FieldError id="email-error" message={errors.email?.message} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
              aria-invalid={!!errors.password}
              aria-describedby="password-error"
              {...form.register("password")}
            />
            <FieldError id="password-error" message={errors.password?.message} />
          </div>
          {error && (
            <p
              role="alert"
              className="rounded-md border border-danger/40 bg-danger-soft px-3 py-2 text-xs text-danger"
            >
              {error}
            </p>
          )}
          <Button type="submit" disabled={!hydrated || isSubmitting} className="mt-1">
            {isSubmitting ? "Please wait…" : mode === "sign-in" ? "Sign in" : "Create account"}
          </Button>
        </form>
        <p className="mt-4 text-center text-xs text-muted-foreground">
          {mode === "sign-in" ? (
            <>
              First time here?{" "}
              <Link href="/sign-up" className="text-primary hover:underline">
                Create the owner account
              </Link>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <Link href="/sign-in" className="text-primary hover:underline">
                Sign in
              </Link>
            </>
          )}
        </p>
      </CardContent>
    </Card>
  );
}
