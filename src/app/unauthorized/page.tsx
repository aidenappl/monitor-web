"use client";

import Image from "next/image";
import { UnauthorizedPage } from "forta-js/react";

export default function Page() {
  return (
    <UnauthorizedPage
      serviceName="Monitor"
      logo={
        <Image
          src="/Monitor-Logo-Transparent.svg"
          alt="Monitor"
          width={40}
          height={40}
          className="h-10 w-10"
          priority
        />
      }
    />
  );
}
