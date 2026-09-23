import { Type } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, ValidateNested } from 'class-validator';
import { MediaDto } from '@gitroom/nestjs-libraries/dtos/media/media.dto';

export class LinkedinDto {
  @IsBoolean()
  @IsOptional()
  post_as_images_carousel: boolean;

  @IsString()
  @IsOptional()
  carousel_name?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => MediaDto)
  thumbnail?: MediaDto;
}
