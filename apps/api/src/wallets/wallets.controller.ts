import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UserEntity } from '../entities/user.entity';
import { ConnectWalletDto } from './dto/connect-wallet.dto';
import { VerifyWalletDto } from './dto/verify-wallet.dto';
import { WalletResponseDto } from './dto/wallet-response.dto';
import { WalletsService } from './wallets.service';

@Controller('wallets')
@UseGuards(JwtAuthGuard)
export class WalletsController {
  constructor(private readonly walletsService: WalletsService) {}

  @Post('connect')
  async connectWallet(
    @CurrentUser() user: UserEntity,
    @Body() connectWalletDto: ConnectWalletDto,
  ): Promise<WalletResponseDto> {
    return this.walletsService.connectWallet(user.id, connectWalletDto);
  }

  @Post('verify')
  async verifyWallet(
    @CurrentUser() user: UserEntity,
    @Body() verifyWalletDto: VerifyWalletDto,
  ): Promise<WalletResponseDto> {
    return this.walletsService.verifyWallet(user.id, verifyWalletDto);
  }

  @Get()
  async getUserWallets(
    @CurrentUser() user: UserEntity,
  ): Promise<WalletResponseDto[]> {
    return this.walletsService.getUserWallets(user.id);
  }

  @Delete(':id')
  async deleteWallet(
    @CurrentUser() user: UserEntity,
    @Param('id') walletId: string,
  ): Promise<{ success: boolean; message: string }> {
    try {
      await this.walletsService.deleteWallet(user.id, walletId);
      return {
        success: true,
        message: 'Wallet deleted successfully',
      };
    } catch (error) {
      console.error(`Error in deleteWallet controller: ${error.message}`);
      throw new HttpException(
        error.message || 'Could not delete wallet',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
