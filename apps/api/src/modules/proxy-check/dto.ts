export interface CheckProxyDto {
  proxyId: string;
}

export interface ProxyCheckErrorDto {
  code: string;
  reasonKey: string;
}

export interface ProxyCheckResultDto {
  reachable: boolean;
  latencyMs?: number;
  exitIp?: string;
  error?: ProxyCheckErrorDto;
}
