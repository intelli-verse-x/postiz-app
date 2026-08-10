import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class ProvisionBrandDto {
  @IsString()
  @MinLength(2)
  @MaxLength(64)
  @Matches(/^[a-z0-9_-]+$/i)
  appId: string;

  @IsString()
  @MinLength(2)
  @MaxLength(128)
  label: string;

  @IsEmail()
  ownerEmail: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password?: string;
}
